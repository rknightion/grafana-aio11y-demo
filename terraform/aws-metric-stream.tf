# AWS/Bedrock CloudWatch metrics -> metric stream -> Firehose -> Grafana Cloud Metrics.
#
# Bedrock's own view (invocations, latency, token counts, throttles per ModelId) next to the SDK and
# gateway telemetry. Only the AWS/Bedrock namespace is streamed.

locals {
  metric_stream = var.bedrock_metric_stream_enabled ? 1 : 0
}

# Firehose reads {"api_key": "<prometheus user id>:<token>"} at delivery time.
resource "aws_secretsmanager_secret" "firehose_metrics" {
  count = local.metric_stream

  name                    = "${local.prefix}/firehose-metrics"
  description             = "Grafana Cloud Metrics credential for the ${local.prefix} AWS/Bedrock metric stream Firehose"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "firehose_metrics" {
  count = local.metric_stream

  secret_id = aws_secretsmanager_secret.firehose_metrics[0].id
  secret_string = jsonencode({
    api_key = "${local.grafana_ingest.prometheus_user_id}:${local.grafana_ingest.metrics_write_token}"
  })
}

resource "aws_s3_bucket" "metric_stream_fallback" {
  count = local.metric_stream

  bucket_prefix = "${local.prefix}-metric-stream-"
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "metric_stream_fallback" {
  count = local.metric_stream

  bucket                  = aws_s3_bucket.metric_stream_fallback[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "metric_stream_fallback" {
  count = local.metric_stream

  bucket = aws_s3_bucket.metric_stream_fallback[0].id
  rule {
    id     = "expire-failed-batches"
    status = "Enabled"
    filter {}
    expiration {
      days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_iam_role" "firehose_metrics" {
  count = local.metric_stream

  name               = "${local.prefix}-bedrock-metrics-firehose"
  description        = "Delivers the ${local.prefix} AWS/Bedrock metric stream to Grafana Cloud Metrics"
  assume_role_policy = data.aws_iam_policy_document.firehose_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "firehose_metrics" {
  count = local.metric_stream

  statement {
    sid    = "WriteFailedBatches"
    effect = "Allow"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:GetObject",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutObject",
    ]
    resources = [aws_s3_bucket.metric_stream_fallback[0].arn, "${aws_s3_bucket.metric_stream_fallback[0].arn}/*"]
  }

  statement {
    sid       = "ReadMetricsCredential"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.firehose_metrics[0].arn]
  }
}

resource "aws_iam_role_policy" "firehose_metrics" {
  count = local.metric_stream

  name   = "${local.prefix}-bedrock-metrics-firehose"
  role   = aws_iam_role.firehose_metrics[0].id
  policy = data.aws_iam_policy_document.firehose_metrics[0].json
}

resource "aws_kinesis_firehose_delivery_stream" "metrics" {
  count = local.metric_stream

  name        = "${local.prefix}-bedrock-metric-stream"
  destination = "http_endpoint"

  http_endpoint_configuration {
    url                = local.grafana_ingest.metric_streams_url
    name               = "Grafana Cloud AWS metric streams"
    buffering_size     = 1
    buffering_interval = 60
    role_arn           = aws_iam_role.firehose_metrics[0].arn
    s3_backup_mode     = "FailedDataOnly"

    secrets_manager_configuration {
      enabled    = true
      secret_arn = aws_secretsmanager_secret.firehose_metrics[0].arn
      role_arn   = aws_iam_role.firehose_metrics[0].arn
    }

    request_configuration {
      content_encoding = "GZIP"
    }

    s3_configuration {
      role_arn           = aws_iam_role.firehose_metrics[0].arn
      bucket_arn         = aws_s3_bucket.metric_stream_fallback[0].arn
      buffering_size     = 5
      buffering_interval = 300
      compression_format = "GZIP"
    }
  }

  tags = var.tags

  depends_on = [aws_iam_role_policy.firehose_metrics, aws_secretsmanager_secret_version.firehose_metrics]
}

data "aws_iam_policy_document" "metric_stream_assume" {
  count = local.metric_stream

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["streams.metrics.cloudwatch.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
  }
}

resource "aws_iam_role" "metric_stream" {
  count = local.metric_stream

  name               = "${local.prefix}-bedrock-metric-stream"
  description        = "Lets CloudWatch stream AWS/Bedrock metrics into the ${local.prefix} Firehose"
  assume_role_policy = data.aws_iam_policy_document.metric_stream_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy" "metric_stream" {
  count = local.metric_stream

  name = "${local.prefix}-bedrock-metric-stream"
  role = aws_iam_role.metric_stream[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["firehose:PutRecord", "firehose:PutRecordBatch"]
      Resource = [aws_kinesis_firehose_delivery_stream.metrics[0].arn]
    }]
  })
}

resource "aws_cloudwatch_metric_stream" "bedrock" {
  count = local.metric_stream

  name          = "${local.prefix}-bedrock"
  role_arn      = aws_iam_role.metric_stream[0].arn
  firehose_arn  = aws_kinesis_firehose_delivery_stream.metrics[0].arn
  output_format = "opentelemetry1.0"

  include_filter {
    namespace = "AWS/Bedrock"
  }

  tags = var.tags

  depends_on = [aws_iam_role_policy.metric_stream]
}
