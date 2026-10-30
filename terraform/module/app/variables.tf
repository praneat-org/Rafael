#---------------------------------------------------------------------------------------------------------------------#
# Common
#---------------------------------------------------------------------------------------------------------------------#

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (dev or prod)"
  type        = string
}

#---------------------------------------------------------------------------------------------------------------------#
# GCP Project
#---------------------------------------------------------------------------------------------------------------------#

variable "project_id" {
  description = "GCP Project ID"
  type        = string
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
}

variable "cloudbuild_trigger_branch_name" {
  description = "Branch regex that triggers a deploy"
  type        = string
}

variable "cloudbuild_approval_required" {
  description = "Require manual approval before the build runs (prod)"
  type        = bool
}

variable "cloudbuild_file_name" {
  description = "CloudBuild yaml file name"
  type        = string
}

#---------------------------------------------------------------------------------------------------------------------#
# Cloud Run (passed to cloudbuild.deploy.yaml as substitutions)
#---------------------------------------------------------------------------------------------------------------------#

variable "cloud_run_service_name" {
  description = "Cloud Run service name"
  type        = string
}

variable "min_instance_count" {
  description = "Cloud Run min instances (Q2 proposal: 1)"
  type        = number
}

variable "max_instance_count" {
  description = "Cloud Run max instances (Q2 proposal: 1, >1 breaks resume)"
  type        = number
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
  description = "Dev only: exact emails allowed outside praneat.com (D13 exception, ALLOWED_EMAILS); keep empty on prod"
  type        = list(string)
  default     = []
}

variable "stt_model" {
  description = "Gemini transcribe model id for live STT (STT_MODEL); empty = no STT"
  type        = string
  default     = ""
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
