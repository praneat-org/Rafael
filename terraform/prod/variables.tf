#---------------------------------------------------------------------------------------------------------------------#
# Common
#---------------------------------------------------------------------------------------------------------------------#

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "prod"
  validation {
    condition     = var.environment == "prod"
    error_message = "terraform/prod is prod only."
  }
}

#---------------------------------------------------------------------------------------------------------------------#
# GCP Project
#---------------------------------------------------------------------------------------------------------------------#

variable "project_id" {
  description = "GCP Project ID (the prod project, never the dev one)"
  type        = string
  validation {
    condition     = var.project_id != "rafael-512903"
    error_message = "rafael-512903 is the dev project: set the prod project id (tfvars copied from dev?)."
  }
}

variable "region" {
  description = "GCP project region"
  type        = string
}

#---------------------------------------------------------------------------------------------------------------------#
# GCP API Services
#---------------------------------------------------------------------------------------------------------------------#

variable "gcloud_service" {
  description = "List of Google Cloud API service names to enable"
  type        = list(string)
}

#---------------------------------------------------------------------------------------------------------------------#
# GCP IAM
#---------------------------------------------------------------------------------------------------------------------#

variable "cloudbuild_sa_role" {
  description = "Project IAM roles for the Cloud Build service account"
  type        = list(string)
}

variable "backend_sa_role" {
  description = "Project IAM roles for the Cloud Run backend service account (no Storage roles, D11)"
  type        = list(string)
}

#---------------------------------------------------------------------------------------------------------------------#
# Secret Manager
#---------------------------------------------------------------------------------------------------------------------#

variable "app_secret_ids" {
  description = "Secret ids mounted into Cloud Run as env of the same name ; empty today (D22: Gemini via Vertex uses the backend SA)"
  type        = list(string)
  default     = []
}

#---------------------------------------------------------------------------------------------------------------------#
# Cloud Build
#---------------------------------------------------------------------------------------------------------------------#

variable "github_connection_name" {
  description = "Cloud Build 2nd gen GitHub host connection, created once in the console"
  type        = string
}

variable "github_repository" {
  description = "GitHub <owner>/<repo>"
  type        = string
  default     = "praneat-org/Rafael"
}

variable "cloudbuild_trigger_branch_name" {
  description = "Branch regex that triggers a deploy (prod: main only, releases come in via release/x.y.z PRs)"
  type        = string
  default     = "^main$"
  validation {
    condition     = var.cloudbuild_trigger_branch_name == "^main$"
    error_message = "prod deploys from main only."
  }
}

variable "cloudbuild_approval_required" {
  description = "Require manual approval before the build runs (always on for prod)"
  type        = bool
  default     = true
  validation {
    condition     = var.cloudbuild_approval_required
    error_message = "prod deploys need a human approval."
  }
}

variable "cloudbuild_file_name" {
  description = "CloudBuild yaml file name"
  type        = string
  default     = "cloudbuild.deploy.yaml"
}

#---------------------------------------------------------------------------------------------------------------------#
# Cloud Run (passed to cloudbuild.deploy.yaml as substitutions)
#---------------------------------------------------------------------------------------------------------------------#

variable "cloud_run_service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "rafael"
  validation {
    condition     = var.cloud_run_service_name == "rafael"
    error_message = "prod service is rafael (rafael-dev is the dev service)."
  }
}

variable "min_instance_count" {
  description = "Cloud Run min instances (Q2 proposal: 1)"
  type        = number
}

variable "max_instance_count" {
  description = "Cloud Run max instances (Q2 proposal: 1, >1 breaks resume)"
  type        = number
  # ponytail: SessionStore is in memory, so resume needs one instance; lift with a shared store
  validation {
    condition     = var.max_instance_count == 1
    error_message = "SessionStore is in memory: more than 1 instance breaks resume."
  }
}

variable "allowed_extension_ids" {
  description = "Chrome extension ids allowed to open /ws (not secret)"
  type        = list(string)
}

variable "oauth_client_id" {
  description = "Chrome Extension OAuth client id (not secret), created by hand in the console"
  type        = string
}

variable "vertex_location" {
  description = "Vertex AI location for Gemini (GOOGLE_CLOUD_LOCATION)"
  type        = string
}

variable "allowed_emails" {
  description = "Dev only (D13 exception); prod is praneat.com only"
  type        = list(string)
  default     = []
  validation {
    condition     = length(var.allowed_emails) == 0
    error_message = "prod must not allow emails outside praneat.com (D13)."
  }
}

variable "stt_model" {
  description = "Gemini transcribe model id for live STT (STT_MODEL); empty = no STT"
  type        = string
  default     = ""
}

variable "stt_end_sensitivity" {
  description = "STT_END_SENSITIVITY; prod stays on the model default (the HIGH value is a dev-only BE-89 experiment)"
  type        = string
  default     = ""
  validation {
    condition     = var.stt_end_sensitivity == ""
    error_message = "prod keeps STT_END_SENSITIVITY empty until the dev experiment is decided."
  }
}

variable "stt_location" {
  description = "Vertex location for STT (STT_LOCATION); the transcribe models only exist at global, unlike vertex_location"
  type        = string
  default     = "global"
}

variable "detector_model" {
  description = "Gemini model id for the Detector (DETECTOR_MODEL)"
  type        = string
}

variable "answerer_model" {
  description = "Gemini model id for the Answerer (ANSWERER_MODEL)"
  type        = string
}
