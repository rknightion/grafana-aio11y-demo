# The agent host: one EC2 instance running docker compose with the Claude apps gateway, its
# Postgres, a PDC agent, a host Alloy and one Claude Code container per developer.
#
# SSM-managed only: no key pair, no inbound rules. user_data is static (prefix, region, secret ARN,
# image refs and the render bundle); every credential and every mutable knob is in the agent-host
# secret, which the host re-reads every 5 minutes, so changing a knob never replaces the host.

# --- TLS: a private CA and a server certificate for the gateway's private hostname -------------

resource "tls_private_key" "gateway_ca" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_self_signed_cert" "gateway_ca" {
  private_key_pem       = tls_private_key.gateway_ca.private_key_pem
  is_ca_certificate     = true
  validity_period_hours = 24 * 365 * 5

  subject {
    common_name  = "${local.prefix} demo private CA"
    organization = local.prefix
  }

  # No subordinate CAs. The tls provider cannot set name constraints, so the CA's reach is bounded
  # instead by where it is trusted: only inside the developer containers (NODE_EXTRA_CA_CERTS and
  # the login bot), and its private key exists only in Terraform state, never on the host.
  max_path_length = 0

  allowed_uses = ["cert_signing", "crl_signing", "digital_signature"]
}

resource "tls_private_key" "gateway" {
  algorithm   = "ECDSA"
  ecdsa_curve = "P256"
}

resource "tls_cert_request" "gateway" {
  private_key_pem = tls_private_key.gateway.private_key_pem
  dns_names       = [local.gateway_hostname, "localhost"]
  ip_addresses    = ["127.0.0.1"]

  subject {
    common_name  = local.gateway_hostname
    organization = local.prefix
  }
}

resource "tls_locally_signed_cert" "gateway" {
  cert_request_pem      = tls_cert_request.gateway.cert_request_pem
  ca_private_key_pem    = tls_private_key.gateway_ca.private_key_pem
  ca_cert_pem           = tls_self_signed_cert.gateway_ca.cert_pem
  validity_period_hours = 24 * 365
  early_renewal_hours   = 24 * 30

  allowed_uses = ["digital_signature", "key_encipherment", "server_auth"]
}

# --- Generated credentials ----------------------------------------------------------------------

resource "random_password" "gateway_jwt_secret" {
  length  = 64
  special = false
}

resource "random_password" "gateway_admin_write_key" {
  length  = 48
  special = false
}

resource "random_password" "gateway_admin_read_key" {
  length  = 48
  special = false
}

resource "random_password" "postgres" {
  length  = 32
  special = false
}

# --- The agent-host secret (JSON keys are a frozen seam with agent-host/) -----------------------

resource "aws_secretsmanager_secret" "agent_host" {
  name                    = "${local.prefix}/agent-host"
  description             = "Credentials the ${local.prefix} agent host reads at boot"
  recovery_window_in_days = 0
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "agent_host" {
  secret_id = aws_secretsmanager_secret.agent_host.id
  secret_string = jsonencode({
    config                       = local.agent_host_config
    cognito_client_secret        = aws_cognito_user_pool_client.gateway.client_secret
    gateway_jwt_secret           = random_password.gateway_jwt_secret.result
    gateway_admin_write_key      = random_password.gateway_admin_write_key.result
    gateway_admin_read_key       = random_password.gateway_admin_read_key.result
    postgres_password            = random_password.postgres.result
    postgres_grafana_ro_password = random_password.grafana_ro.result
    grafana_otlp_token           = local.grafana_ingest.otlp_token
    agento11y_client_token       = local.grafana_ingest.agento11y_client_token
    pdc_token                    = local.grafana_ingest.pdc_token
    tls_ca_pem                   = tls_self_signed_cert.gateway_ca.cert_pem
    tls_cert_pem                 = tls_locally_signed_cert.gateway.cert_pem
    tls_key_pem                  = tls_private_key.gateway.private_key_pem
    developer_passwords          = { for name, p in random_password.developer : name => p.result }
  })
}

# --- Instance -----------------------------------------------------------------------------------

locals {
  agent_host = var.agent_host_enabled ? 1 : 0

  agent_host_dir = "${path.module}/../agent-host"

  # The files that run as root on the host. They are uploaded to a module-owned bucket and
  # user_data carries each one's SHA-256, so the host installs exactly what this apply rendered;
  # nothing root-run with the secret comes from a pulled image. Too big for EC2's 16 KB user_data
  # limit inline. Changing one changes user_data and so replaces the host.
  agent_host_bundle = {
    "/opt/agent-host/render/render.py"             = { mode = "0755", source = "render/render.py" }
    "/opt/agent-host/config/alloy.alloy"           = { mode = "0644", source = "config/alloy.alloy" }
    "/opt/agent-host/config/postgres-bootstrap.sh" = { mode = "0644", source = "config/postgres-bootstrap.sh" }
    "/usr/local/sbin/agent-host-up"                = { mode = "0755", source = "host/agent-host-up" }
    "/usr/local/sbin/agent-host-firewall"          = { mode = "0755", source = "host/agent-host-firewall" }
    "/usr/local/sbin/agent-host-install-compose"   = { mode = "0755", source = "host/agent-host-install-compose" }
    "/usr/local/bin/agent-host-login-links"        = { mode = "0755", source = "host/agent-host-login-links" }
  }
  agent_host_bundle_files = { for path, f in local.agent_host_bundle : path => merge(f, {
    content = file("${local.agent_host_dir}/${f.source}")
    sha256  = filesha256("${local.agent_host_dir}/${f.source}")
  }) }

  agent_host_user_data = base64gzip(templatefile("${local.agent_host_dir}/cloud-init.yaml.tftpl", {
    name               = local.prefix
    aws_region         = local.aws_region
    secret_arn         = aws_secretsmanager_secret.agent_host.arn
    images_registry    = var.images.registry
    images_name_prefix = var.images.name_prefix
    images_tag         = var.images.tag
    # Optional per-image digest pins ({gateway = "sha256:...", "dev-workstation" = "sha256:..."}).
    images_digests_json = jsonencode(var.images.digests)
    bundle_bucket       = var.agent_host_enabled ? aws_s3_bucket.agent_host_bundle[0].id : ""
    bundle_json = jsonencode({ for path, f in local.agent_host_bundle_files : path => {
      mode = f.mode, sha256 = f.sha256, key = "bundle/${f.sha256}/${basename(path)}"
    } })
  }))

  # Mutable knobs: the `config` key of the agent-host secret (agent-host/SEAM.md). A change here
  # updates the secret version only; the host picks it up within 5 minutes.
  agent_host_config = {
    gateway_hostname         = local.gateway_hostname
    claude_code_version      = var.claude_code_version
    agento11y_cli_version    = var.agento11y_cli_version
    developers               = [for name, d in local.developers : { name = name, email = d.email, team = d.team, sub = aws_cognito_user.developer[name].sub }]
    teams                    = var.teams
    spend_caps               = var.spend_caps
    gateway_models           = local.gateway_models
    team_model_allowlist     = var.team_model_allowlist
    cognito_issuer           = local.cognito_issuer
    cognito_client_id        = aws_cognito_user_pool_client.gateway.id
    cognito_domain_url       = local.cognito_domain_url
    traffic_enabled          = var.traffic_enabled
    session_interval_minutes = var.developer_session_interval_minutes
    content_capture          = var.content_capture
    grafana_otlp_endpoint    = local.grafana_ingest.otlp_endpoint
    grafana_otlp_username    = local.grafana_ingest.otlp_username
    agento11y_endpoint       = local.grafana_ingest.agento11y_endpoint
    agento11y_tenant         = local.grafana_ingest.agento11y_tenant
    pdc_cluster              = local.grafana_ingest.pdc_cluster
    pdc_hosted_grafana_id    = local.grafana_ingest.stack_id
    service_names            = local.service_names
  }

  # ECR pull scope when images come from a private ECR mirror (`just images-push`):
  # <account>.dkr.ecr.<region>.amazonaws.com[/<path>] -> exactly this repo's two repositories,
  # named <path>/<name_prefix><image> (name_prefix is typically "" for an ECR mirror, whose
  # repositories are already <registry>/<app>).
  agent_host_ecr = try(regex("^(?P<account>[0-9]+)\\.dkr\\.ecr\\.(?P<region>[a-z0-9-]+)\\.amazonaws\\.com(?:/(?P<path>.+))?$", trimsuffix(var.images.registry, "/")), null)

  # Gateway model id from a system profile id: "eu.anthropic.claude-haiku-4-5-20251001-v1:0" ->
  # "claude-haiku-4-5", "eu.anthropic.claude-sonnet-4-6" -> "claude-sonnet-4-6".
  gateway_models = [for k in var.gateway_models : {
    key = k
    id  = replace(regex("anthropic\\.(.+)$", var.bedrock_models[k])[0], "/-[0-9]{8}-v[0-9]+:[0-9]+$/", "")
    upstream_profile_arns_by_team = {
      for t in var.teams : t => aws_bedrock_inference_profile.team_model["${t}.${k}"].arn
    }
  } if contains(keys(var.bedrock_models), k)]
}

# --- Render bundle bucket ------------------------------------------------------------------------

resource "aws_s3_bucket" "agent_host_bundle" {
  count = local.agent_host

  bucket_prefix = substr("${local.prefix}-agent-host-", 0, 37)
  force_destroy = true
  tags          = var.tags
}

resource "aws_s3_bucket_public_access_block" "agent_host_bundle" {
  count = local.agent_host

  bucket                  = aws_s3_bucket.agent_host_bundle[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "agent_host_bundle" {
  count = local.agent_host

  bucket = aws_s3_bucket.agent_host_bundle[0].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "agent_host_bundle" {
  count = local.agent_host

  bucket = aws_s3_bucket.agent_host_bundle[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_policy" "agent_host_bundle" {
  count = local.agent_host

  bucket = aws_s3_bucket.agent_host_bundle[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.agent_host_bundle[0].arn, "${aws_s3_bucket.agent_host_bundle[0].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.agent_host_bundle]
}

# Content-addressed keys: an object is never overwritten in place.
resource "aws_s3_object" "agent_host_bundle" {
  for_each = var.agent_host_enabled ? local.agent_host_bundle_files : {}

  bucket       = aws_s3_bucket.agent_host_bundle[0].id
  key          = "bundle/${each.value.sha256}/${basename(each.key)}"
  content      = each.value.content
  content_type = "text/plain; charset=utf-8"
  tags         = var.tags
}

data "aws_subnet" "agent_host" {
  count = local.agent_host

  id = var.agent_host_subnet_id

  lifecycle {
    precondition {
      condition     = var.agent_host_subnet_id != null
      error_message = "agent_host_subnet_id is required when agent_host_enabled is true (a subnet with outbound internet)."
    }
  }
}

data "aws_ec2_instance_type" "agent_host" {
  instance_type = var.agent_host_instance_type
}

data "aws_ssm_parameter" "al2023_ami" {
  count = local.agent_host

  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-${contains(data.aws_ec2_instance_type.agent_host.supported_architectures, "arm64") ? "arm64" : "x86_64"}"
}

resource "aws_security_group" "agent_host" {
  count = local.agent_host

  name        = local.service_names.agent_host
  description = "${local.prefix} agent host: no inbound, all outbound (SSM, images, Bedrock, Grafana Cloud)"
  vpc_id      = data.aws_subnet.agent_host[0].vpc_id
  tags        = merge(var.tags, { Name = local.service_names.agent_host })
}

resource "aws_vpc_security_group_egress_rule" "agent_host_ipv4" {
  count = local.agent_host

  security_group_id = aws_security_group.agent_host[0].id
  description       = "All outbound IPv4"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
  tags              = var.tags
}

resource "aws_vpc_security_group_egress_rule" "agent_host_ipv6" {
  count = local.agent_host

  security_group_id = aws_security_group.agent_host[0].id
  description       = "All outbound IPv6"
  ip_protocol       = "-1"
  cidr_ipv6         = "::/0"
  tags              = var.tags
}

data "aws_iam_policy_document" "agent_host_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "agent_host" {
  count = local.agent_host

  name               = local.service_names.agent_host
  description        = "${local.prefix} agent host: gateway Bedrock upstream, boot secret, SSM"
  assume_role_policy = data.aws_iam_policy_document.agent_host_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy" "agent_host_bedrock" {
  count = local.agent_host

  name   = "${local.prefix}-agent-host-bedrock"
  role   = aws_iam_role.agent_host[0].id
  policy = data.aws_iam_policy_document.bedrock_invoke.json
}

resource "aws_iam_role_policy" "agent_host_bundle" {
  count = local.agent_host

  name = "${local.prefix}-agent-host-bundle"
  role = aws_iam_role.agent_host[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadRenderBundle"
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = ["${aws_s3_bucket.agent_host_bundle[0].arn}/bundle/*"]
    }]
  })
}

resource "aws_iam_role_policy" "agent_host_secret" {
  count = local.agent_host

  name = "${local.prefix}-agent-host-secret"
  role = aws_iam_role.agent_host[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadBootSecret"
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [aws_secretsmanager_secret.agent_host.arn]
    }]
  })
}

# Session Manager and Run Command only. Replaces AmazonSSMManagedInstanceCore, which also grants
# ssm:GetParameter* on every parameter in the account.
resource "aws_iam_role_policy" "agent_host_ssm" {
  count = local.agent_host

  name = "${local.prefix}-agent-host-ssm"
  role = aws_iam_role.agent_host[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SsmAgent"
        Effect = "Allow"
        Action = [
          "ssm:UpdateInstanceInformation",
          "ssm:ListInstanceAssociations",
          "ssm:DescribeAssociation",
          "ssm:UpdateInstanceAssociationStatus",
        ]
        Resource = ["*"]
      },
      {
        Sid    = "SessionManagerChannels"
        Effect = "Allow"
        Action = [
          "ssmmessages:CreateControlChannel",
          "ssmmessages:CreateDataChannel",
          "ssmmessages:OpenControlChannel",
          "ssmmessages:OpenDataChannel",
        ]
        Resource = ["*"]
      },
      {
        Sid    = "RunCommandMessages"
        Effect = "Allow"
        Action = [
          "ec2messages:AcknowledgeMessage",
          "ec2messages:DeleteMessage",
          "ec2messages:FailMessage",
          "ec2messages:GetEndpoint",
          "ec2messages:GetMessages",
          "ec2messages:SendReply",
        ]
        Resource = ["*"]
      },
    ]
  })
}

# Only when images come from a private ECR mirror (`just images-push`), and only its two
# repositories.
resource "aws_iam_role_policy" "agent_host_ecr" {
  count = var.agent_host_enabled && local.agent_host_ecr != null ? 1 : 0

  name = "${local.prefix}-agent-host-ecr"
  role = aws_iam_role.agent_host[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = ["*"]
      },
      {
        Sid    = "PullAgentHostImages"
        Effect = "Allow"
        Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = [for image in ["gateway", "dev-workstation"] : format(
          "arn:%s:ecr:%s:%s:repository/%s%s%s", local.aws_partition, local.agent_host_ecr.region,
          local.agent_host_ecr.account, local.agent_host_ecr.path == null ? "" : "${local.agent_host_ecr.path}/",
          var.images.name_prefix, image
        )]
      },
    ]
  })
}

resource "aws_iam_instance_profile" "agent_host" {
  count = local.agent_host

  name = local.service_names.agent_host
  role = aws_iam_role.agent_host[0].name
  tags = var.tags
}

resource "aws_instance" "agent_host" {
  count = local.agent_host

  ami                    = data.aws_ssm_parameter.al2023_ami[0].insecure_value
  instance_type          = var.agent_host_instance_type
  subnet_id              = data.aws_subnet.agent_host[0].id
  vpc_security_group_ids = [aws_security_group.agent_host[0].id]
  iam_instance_profile   = aws_iam_instance_profile.agent_host[0].name

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_protocol_ipv6          = "disabled" # IMDS is reachable over IPv4 only; the firewall filters that path
    http_put_response_hop_limit = 2          # containers on the Docker bridge need one extra hop
    instance_metadata_tags      = "disabled"
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 60
    encrypted             = true
    delete_on_termination = true
    tags                  = merge(var.tags, { Name = local.service_names.agent_host })
  }

  # Static: no knob or credential (see local.agent_host_user_data).
  user_data_base64            = local.agent_host_user_data
  user_data_replace_on_change = true

  tags = merge(var.tags, { Name = local.service_names.agent_host })

  lifecycle {
    # A newer AL2023 AMI must not replace the host (and its signed-in developers) on a later apply.
    ignore_changes = [ami]

    precondition {
      condition     = alltrue([for k in var.gateway_models : contains(keys(var.bedrock_models), k)])
      error_message = "Every gateway_models entry must be a key of bedrock_models."
    }
    precondition {
      condition     = alltrue([for d in var.developers : contains(var.teams, d.team)])
      error_message = "Every developer's team must be listed in teams."
    }
    precondition {
      condition     = alltrue([for t, keys in var.team_model_allowlist : length(setintersection(keys, var.gateway_models)) > 0])
      error_message = "Every team_model_allowlist entry must name at least one gateway_models key."
    }
    precondition {
      # EC2 limits user data to 16 KB before base64 (here: the gzip of the rendered cloud-init).
      condition     = floor(length(local.agent_host_user_data) * 3 / 4) <= 16384
      error_message = "The agent-host user_data is over EC2's 16 KB limit."
    }
  }

  depends_on = [
    aws_secretsmanager_secret_version.agent_host,
    aws_iam_role_policy.agent_host_secret,
    aws_iam_role_policy.agent_host_ssm,
    aws_iam_role_policy.agent_host_bundle,
    aws_s3_object.agent_host_bundle,
  ]
}
