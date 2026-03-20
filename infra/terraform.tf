terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      #   version = "~> 5.92" : use latest version
    }
  }
  required_version = ">= 1.2"
}
