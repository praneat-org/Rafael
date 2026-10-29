terraform {
  required_version = ">= 1.15.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  ## Create once before init: gcloud storage buckets create gs://terraform-state-rafael-dev --location=asia-southeast1 --uniform-bucket-level-access, then: gcloud storage buckets update gs://terraform-state-rafael-dev --versioning ##
  backend "gcs" {
    bucket = "terraform-state-rafael-dev"
    prefix = "infra"
  }
}

## Runs with your gcloud ADC (gcloud auth application-default login) ##
provider "google" {
  project = var.project_id
  region  = var.region

  default_labels = {
    project_name = var.project_name
    environment  = var.environment
  }
}

module "app" {
  source = "../module/app"
  # ---------------- Common ---------------- #
  project_name = var.project_name
  environment  = var.environment
  # ---------------- GCP Project ---------------- #
  project_id     = var.project_id
  region         = var.region
  gcloud_service = var.gcloud_service
  # ---------------- GCP IAM ---------------- #
  cloudbuild_sa_role = var.cloudbuild_sa_role
  backend_sa_role    = var.backend_sa_role
  # ---------------- Secret Manager ---------------- #
  app_secret_ids = var.app_secret_ids
  # ---------------- Cloud Build ---------------- #
  github_connection_name         = var.github_connection_name
  github_repository              = var.github_repository
  cloudbuild_trigger_branch_name = var.cloudbuild_trigger_branch_name
  cloudbuild_approval_required   = var.cloudbuild_approval_required
  cloudbuild_file_name           = var.cloudbuild_file_name
  # ---------------- Cloud Run ---------------- #
  cloud_run_service_name = var.cloud_run_service_name
  min_instance_count     = var.min_instance_count
  max_instance_count     = var.max_instance_count
  allowed_extension_ids  = var.allowed_extension_ids
  oauth_client_id        = var.oauth_client_id
  vertex_location        = var.vertex_location
  detector_model         = var.detector_model
  answerer_model         = var.answerer_model
  allowed_emails         = var.allowed_emails
}
