variable "aws_region" {
  description = "Region for the VPC and cluster. Pick one where your Bedrock cross-region inference profiles are valid (eu-* for eu. profiles, us-* for us. profiles)."
  type        = string
  default     = "eu-west-1"
}

variable "name" {
  description = "Name for the VPC and the EKS cluster."
  type        = string
  default     = "touchline"
}

variable "kubernetes_version" {
  description = "EKS Kubernetes version, for example \"1.35\". null takes the EKS default for new clusters. A version past standard support bills extended-support rates for the control plane."
  type        = string
  default     = null
}

variable "vpc_cidr" {
  description = "VPC CIDR. Two public and two private /20 subnets are carved from it."
  type        = string
  default     = "10.42.0.0/16"
}

variable "single_nat_gateway" {
  description = "One NAT gateway for the whole VPC (cheapest). false gives one per AZ."
  type        = bool
  default     = true
}

variable "endpoint_public_access_cidrs" {
  description = "CIDRs allowed to reach the public EKS API endpoint. Narrow this to your own address."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "tags" {
  description = "Tags on every resource."
  type        = map(string)
  default = {
    Project = "touchline-demo"
  }
}
