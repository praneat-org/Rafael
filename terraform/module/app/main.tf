terraform {
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.33"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.19"
    }
  }
}
