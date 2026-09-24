# Amazon Cognito: the OIDC identity provider for the Claude apps gateway.
#
# One group per team (the gateway reads cognito:groups for policies, spend caps and user.groups in
# telemetry) and one user per developer with a permanent generated password, so the agent host can
# sign every developer in without a first-login password change.

locals {
  gateway_hostname = "${local.prefix}-gateway.internal"
}

resource "random_string" "cognito_domain" {
  length  = 8
  lower   = true
  upper   = false
  numeric = true
  special = false
}

resource "aws_cognito_user_pool" "gateway" {
  name                = "${local.prefix}-gateway"
  alias_attributes    = ["email"]
  mfa_configuration   = "OFF"
  deletion_protection = "INACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 16
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "admin_only"
      priority = 1
    }
  }

  tags = var.tags
}

resource "aws_cognito_user_group" "team" {
  for_each = local.teams

  name         = each.key
  description  = "${local.prefix} ${each.key} team"
  user_pool_id = aws_cognito_user_pool.gateway.id
}

resource "random_password" "developer" {
  for_each = local.developers

  length           = 24
  min_lower        = 2
  min_upper        = 2
  min_numeric      = 2
  min_special      = 2
  override_special = "!#%*-_=+"
}

resource "aws_cognito_user" "developer" {
  for_each = local.developers

  user_pool_id   = aws_cognito_user_pool.gateway.id
  username       = each.key
  password       = random_password.developer[each.key].result
  message_action = "SUPPRESS"

  attributes = {
    email          = each.value.email
    email_verified = "true"
  }
}

resource "aws_cognito_user_in_group" "developer" {
  for_each = local.developers

  user_pool_id = aws_cognito_user_pool.gateway.id
  group_name   = aws_cognito_user_group.team[each.value.team].name
  username     = aws_cognito_user.developer[each.key].username
}

resource "aws_cognito_user_pool_client" "gateway" {
  name         = "${local.prefix}-gateway"
  user_pool_id = aws_cognito_user_pool.gateway.id

  generate_secret                      = true
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  supported_identity_providers         = ["COGNITO"]
  callback_urls                        = ["https://${local.gateway_hostname}/oauth/callback"]
  default_redirect_uri                 = "https://${local.gateway_hostname}/oauth/callback"
  logout_urls                          = ["https://${local.gateway_hostname}/"]
  explicit_auth_flows                  = ["ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  read_attributes                      = ["email", "email_verified"]

  # Long refresh tokens keep developer sessions alive across a multi-day demo.
  access_token_validity  = 1
  id_token_validity      = 1
  refresh_token_validity = 30

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }
}

# Classic hosted UI (managed_login_version 1): the sign-in bot drives its plain HTML form.
resource "aws_cognito_user_pool_domain" "gateway" {
  domain                = "${local.prefix}-gateway-${random_string.cognito_domain.result}"
  user_pool_id          = aws_cognito_user_pool.gateway.id
  managed_login_version = 1
}

locals {
  cognito_issuer     = "https://${aws_cognito_user_pool.gateway.endpoint}"
  cognito_domain_url = "https://${aws_cognito_user_pool_domain.gateway.domain}.auth.${local.aws_region}.amazoncognito.com"
}
