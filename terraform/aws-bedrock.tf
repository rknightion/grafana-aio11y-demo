# Amazon Bedrock: per-team application inference profiles and optional model invocation logging.
#
# Each team gets one application inference profile per bedrock_models entry, copied from the system
# cross-region profile the variable names. Application profiles carry this module's tags, so Bedrock
# cost and usage can be split by team, and the agents and the gateway call the profile ARN rather
# than a shared system profile.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  aws_region     = data.aws_region.current.region
  aws_account_id = data.aws_caller_identity.current.account_id
  aws_partition  = data.aws_partition.current.partition

  # System profile id prefix => the region-name prefix it is valid from. "global." works anywhere.
  bedrock_geo_region_prefixes = {
    eu       = "eu-"
    us       = "us-"
    "us-gov" = "us-gov-"
    apac     = "ap-"
    jp       = "ap-northeast-"
    au       = "ap-southeast-"
    ca       = "ca-"
    global   = ""
  }

  # Every foundation-model ARN the system profiles route to, read from Bedrock at plan time. An
  # application profile copied from a system profile routes to the same set, and IAM evaluates the
  # foundation model in whichever region serves the request, so every one must be granted.
  bedrock_foundation_model_arns = distinct(flatten([
    for p in data.aws_bedrock_inference_profile.source : p.models[*].model_arn
  ]))

  bedrock_team_profile_arns = [for p in aws_bedrock_inference_profile.team_model : p.arn]

  bedrock_invocation_log_group = "/aws/bedrock/${local.prefix}-invocations"
}

data "aws_bedrock_inference_profile" "source" {
  for_each = var.bedrock_models

  inference_profile_id = each.value

  lifecycle {
    precondition {
      condition = (
        contains(keys(local.bedrock_geo_region_prefixes), split(".", each.value)[0]) &&
        startswith(local.aws_region, lookup(local.bedrock_geo_region_prefixes, split(".", each.value)[0], "-"))
      )
      error_message = "bedrock_models.${each.key} = \"${each.value}\" is not a system cross-region inference profile valid in ${local.aws_region}. Use a profile whose prefix (eu., us., apac., global. ...) matches the provider region."
    }
  }
}

resource "aws_bedrock_inference_profile" "team_model" {
  for_each = local.team_models

  name        = "${local.prefix}-${each.value.team}-${each.value.model}"
  description = "${local.prefix} ${each.value.team} team, ${each.value.model} (copied from ${each.value.source_profile})"

  model_source {
    copy_from = data.aws_bedrock_inference_profile.source[each.value.model].inference_profile_arn
  }

  tags = merge(var.tags, {
    Team  = each.value.team
    Model = each.value.model
  })
}

# Invoke rights shared by the in-cluster agents and the agent host (gateway upstream).
data "aws_iam_policy_document" "bedrock_invoke" {
  statement {
    sid    = "InvokeTeamProfiles"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
      "bedrock:CountTokens",
      "bedrock:GetInferenceProfile",
    ]
    resources = local.bedrock_team_profile_arns
  }

  # Direct foundation-model invocation is allowed only when the request arrives through one of this
  # module's application profiles.
  statement {
    sid    = "InvokeBackingModelsThroughTeamProfiles"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = local.bedrock_foundation_model_arns

    condition {
      test     = "ArnEquals"
      variable = "bedrock:InferenceProfileArn"
      values   = local.bedrock_team_profile_arns
    }
  }

  # CountTokens is free and is called against the foundation model directly (the gateway uses it to
  # keep spend limits accurate for abandoned requests).
  statement {
    sid       = "CountTokens"
    effect    = "Allow"
    actions   = ["bedrock:CountTokens"]
    resources = local.bedrock_foundation_model_arns
  }
}

# --- Model invocation logging (opt-in, account- and region-wide) --------------------------------
#
# Bedrock -> CloudWatch Logs (KMS) -> subscription filter -> Firehose -> Grafana Cloud Logs.
# Large payloads and failed Firehose batches land in an S3 bucket that destroy empties.

locals {
  invocation_logging = var.bedrock_invocation_logging_enabled ? 1 : 0
}

data "aws_iam_policy_document" "invocation_logging_key" {
  count = local.invocation_logging

  statement {
    sid    = "AccountAdministration"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = ["arn:${local.aws_partition}:iam::${local.aws_account_id}:root"]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  # The literal log-group ARN avoids a key <-> log group dependency cycle.
  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["logs.${local.aws_region}.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
    condition {
      test     = "ArnEquals"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${local.aws_partition}:logs:${local.aws_region}:${local.aws_account_id}:log-group:${local.bedrock_invocation_log_group}"]
    }
  }

  statement {
    sid    = "BedrockLargeDataDelivery"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }
    actions   = ["kms:GenerateDataKey"]
    resources = ["*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.aws_partition}:bedrock:${local.aws_region}:${local.aws_account_id}:*"]
    }
  }
}

resource "aws_kms_key" "invocation_logging" {
  count = local.invocation_logging

  description             = "${local.prefix} Bedrock invocation log encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.invocation_logging_key[0].json
  tags                    = var.tags
}

resource "aws_kms_alias" "invocation_logging" {
  count = local.invocation_logging

  name          = "alias/${local.prefix}-bedrock-invocation-logging"
  target_key_id = aws_kms_key.invocation_logging[0].key_id
}

resource "aws_cloudwatch_log_group" "invocations" {
  count = local.invocation_logging

  name              = local.bedrock_invocation_log_group
  retention_in_days = 7
  kms_key_id        = aws_kms_key.invocation_logging[0].arn
  tags              = var.tags
}

resource "aws_s3_bucket" "invocation_overflow" {
  count = local.invocation_logging

  bucket_prefix = "${local.prefix}-bedrock-logs-"
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "invocation_overflow" {
  count = local.invocation_logging

  bucket                  = aws_s3_bucket.invocation_overflow[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "invocation_overflow" {
  count = local.invocation_logging

  bucket = aws_s3_bucket.invocation_overflow[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "invocation_overflow" {
  count = local.invocation_logging

  bucket = aws_s3_bucket.invocation_overflow[0].id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.invocation_logging[0].arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "invocation_overflow" {
  count = local.invocation_logging

  bucket = aws_s3_bucket.invocation_overflow[0].id
  rule {
    id     = "expire-invocation-content"
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

data "aws_iam_policy_document" "invocation_overflow_bucket" {
  count = local.invocation_logging

  statement {
    sid    = "BedrockLargeDataWrite"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.invocation_overflow[0].arn}/bedrock-large-data/AWSLogs/${local.aws_account_id}/BedrockModelInvocationLogs/*"]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.aws_partition}:bedrock:${local.aws_region}:${local.aws_account_id}:*"]
    }
  }
}

resource "aws_s3_bucket_policy" "invocation_overflow" {
  count = local.invocation_logging

  bucket = aws_s3_bucket.invocation_overflow[0].id
  policy = data.aws_iam_policy_document.invocation_overflow_bucket[0].json

  depends_on = [aws_s3_bucket_ownership_controls.invocation_overflow, aws_s3_bucket_public_access_block.invocation_overflow]
}

data "aws_iam_policy_document" "bedrock_logging_assume" {
  count = local.invocation_logging

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["bedrock.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
  }
}

resource "aws_iam_role" "bedrock_logging" {
  count = local.invocation_logging

  name               = "${local.prefix}-bedrock-invocation-logging"
  description        = "Lets Bedrock deliver invocation logs to the ${local.prefix} log group and overflow bucket"
  assume_role_policy = data.aws_iam_policy_document.bedrock_logging_assume[0].json
  tags               = var.tags
}

data "aws_iam_policy_document" "bedrock_logging" {
  count = local.invocation_logging

  statement {
    sid       = "WriteInvocationLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.invocations[0].arn}:*"]
  }

  statement {
    sid       = "WriteOverflowObjects"
    effect    = "Allow"
    actions   = ["s3:PutObject", "s3:GetBucketLocation"]
    resources = [aws_s3_bucket.invocation_overflow[0].arn, "${aws_s3_bucket.invocation_overflow[0].arn}/*"]
  }

  statement {
    sid       = "EncryptInvocationContent"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.invocation_logging[0].arn]
  }
}

resource "aws_iam_role_policy" "bedrock_logging" {
  count = local.invocation_logging

  name   = "${local.prefix}-bedrock-invocation-logging"
  role   = aws_iam_role.bedrock_logging[0].id
  policy = data.aws_iam_policy_document.bedrock_logging[0].json
}

# Account- and region-wide: replaces any existing configuration, and destroy removes it.
resource "aws_bedrock_model_invocation_logging_configuration" "this" {
  count = local.invocation_logging

  logging_config {
    text_data_delivery_enabled      = true
    image_data_delivery_enabled     = false
    embedding_data_delivery_enabled = false

    cloudwatch_config {
      log_group_name = aws_cloudwatch_log_group.invocations[0].name
      role_arn       = aws_iam_role.bedrock_logging[0].arn

      large_data_delivery_s3_config {
        bucket_name = aws_s3_bucket.invocation_overflow[0].bucket
        key_prefix  = "bedrock-large-data"
      }
    }
  }

  depends_on = [
    aws_iam_role_policy.bedrock_logging,
    aws_s3_bucket_policy.invocation_overflow,
    aws_s3_bucket_server_side_encryption_configuration.invocation_overflow,
  ]
}

# Firehose reads {"api_key": "<loki user id>:<token>"} from this secret at delivery time, so the
# credential never appears in the delivery stream configuration.
resource "aws_secretsmanager_secret" "firehose_logs" {
  count = local.invocation_logging

  name                    = "${local.prefix}/firehose-logs"
  description             = "Grafana Cloud Logs credential for the ${local.prefix} Bedrock invocation log Firehose"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "firehose_logs" {
  count = local.invocation_logging

  secret_id = aws_secretsmanager_secret.firehose_logs[0].id
  secret_string = jsonencode({
    api_key = "${local.grafana_ingest.loki_user_id}:${local.grafana_ingest.logs_write_token}"
  })
}

data "aws_iam_policy_document" "firehose_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["firehose.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
  }
}

resource "aws_iam_role" "firehose_logs" {
  count = local.invocation_logging

  name               = "${local.prefix}-bedrock-logs-firehose"
  description        = "Delivers ${local.prefix} Bedrock invocation logs to Grafana Cloud Logs"
  assume_role_policy = data.aws_iam_policy_document.firehose_assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "firehose_logs" {
  count = local.invocation_logging

  statement {
    sid    = "WriteFailedRecords"
    effect = "Allow"
    actions = [
      "s3:AbortMultipartUpload",
      "s3:GetBucketLocation",
      "s3:ListBucket",
      "s3:ListBucketMultipartUploads",
      "s3:PutObject",
    ]
    resources = [aws_s3_bucket.invocation_overflow[0].arn, "${aws_s3_bucket.invocation_overflow[0].arn}/*"]
  }

  statement {
    sid       = "UseOverflowKey"
    effect    = "Allow"
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.invocation_logging[0].arn]
  }

  statement {
    sid       = "ReadLogsCredential"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.firehose_logs[0].arn]
  }
}

resource "aws_iam_role_policy" "firehose_logs" {
  count = local.invocation_logging

  name   = "${local.prefix}-bedrock-logs-firehose"
  role   = aws_iam_role.firehose_logs[0].id
  policy = data.aws_iam_policy_document.firehose_logs[0].json
}

resource "aws_kinesis_firehose_delivery_stream" "invocation_logs" {
  count = local.invocation_logging

  name        = "${local.prefix}-bedrock-invocation-logs"
  destination = "http_endpoint"

  http_endpoint_configuration {
    url                = local.grafana_ingest.firehose_logs_url
    name               = "Grafana Cloud Logs"
    buffering_size     = 1
    buffering_interval = 60
    role_arn           = aws_iam_role.firehose_logs[0].arn
    s3_backup_mode     = "FailedDataOnly"

    secrets_manager_configuration {
      enabled    = true
      secret_arn = aws_secretsmanager_secret.firehose_logs[0].arn
      role_arn   = aws_iam_role.firehose_logs[0].arn
    }

    # lbl_* common attributes become static Loki labels (prefix stripped).
    request_configuration {
      content_encoding = "GZIP"

      common_attributes {
        name  = "lbl_service_name"
        value = "${local.prefix}-bedrock-invocations"
      }
      common_attributes {
        name  = "lbl_service_namespace"
        value = local.prefix
      }
    }

    s3_configuration {
      role_arn            = aws_iam_role.firehose_logs[0].arn
      bucket_arn          = aws_s3_bucket.invocation_overflow[0].arn
      buffering_size      = 5
      buffering_interval  = 300
      compression_format  = "GZIP"
      kms_key_arn         = aws_kms_key.invocation_logging[0].arn
      error_output_prefix = "firehose-failed/"
    }
  }

  tags = var.tags

  depends_on = [aws_iam_role_policy.firehose_logs, aws_secretsmanager_secret_version.firehose_logs]
}

# SourceAccount is the only trust condition: an ARN condition fails the subscription's test message.
data "aws_iam_policy_document" "logs_to_firehose_assume" {
  count = local.invocation_logging

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["logs.${local.aws_region}.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.aws_account_id]
    }
  }
}

resource "aws_iam_role" "logs_to_firehose" {
  count = local.invocation_logging

  name               = "${local.prefix}-bedrock-logs-subscription"
  description        = "Lets CloudWatch Logs forward ${local.prefix} Bedrock invocation logs to Firehose"
  assume_role_policy = data.aws_iam_policy_document.logs_to_firehose_assume[0].json
  tags               = var.tags
}

resource "aws_iam_role_policy" "logs_to_firehose" {
  count = local.invocation_logging

  name = "${local.prefix}-bedrock-logs-subscription"
  role = aws_iam_role.logs_to_firehose[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["firehose:PutRecord", "firehose:PutRecordBatch"]
      Resource = [aws_kinesis_firehose_delivery_stream.invocation_logs[0].arn]
    }]
  })
}

resource "aws_cloudwatch_log_subscription_filter" "invocations" {
  count = local.invocation_logging

  name            = "${local.prefix}-bedrock-to-grafana"
  log_group_name  = aws_cloudwatch_log_group.invocations[0].name
  filter_pattern  = ""
  destination_arn = aws_kinesis_firehose_delivery_stream.invocation_logs[0].arn
  role_arn        = aws_iam_role.logs_to_firehose[0].arn
  distribution    = "ByLogStream"

  depends_on = [aws_iam_role_policy.logs_to_firehose]
}
