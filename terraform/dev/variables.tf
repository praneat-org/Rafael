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
  default     = "praneat-org/Rafael"
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
  default     = "cloudbuild.deploy.yaml"
}

#---------------------------------------------------------------------------------------------------------------------#
# Cloud Run (passed to cloudbuild.deploy.yaml as substitutions)
#---------------------------------------------------------------------------------------------------------------------#

variable "cloud_run_service_name" {
  description = "Cloud Run service name"
  type        = string
  validation {
    condition     = var.cloud_run_service_name != "rafael"
    error_message = "rafael is the prod service (same project): dev must not deploy over it."
  }
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

# DEV ONLY - prod must be "" (BE-89 field experiment; copying terraform/dev to prod must override this)
variable "stt_end_sensitivity" {
  description = "STT_END_SENSITIVITY (HIGH|LOW); empty = model default. BE-89 dev field experiment, prod leaves it empty"
  type        = string
  default     = "HIGH"
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

variable "summary_model" {
  description = "Gemini model id for the meeting summary (SUMMARY_MODEL); empty = answerer model"
  type        = string
  default     = ""
}

#---------------------------------------------------------------------------------------------------------------------#
# Web version (CAR-3845)
#---------------------------------------------------------------------------------------------------------------------#

variable "web_oauth_client_id" {
  description = "OAuth client id of type Web application for the web version (not secret): token aud on the server + sign-in in the web bundle"
  type        = string
  default     = ""
}

variable "feedback_url" {
  description = "Feedback form URL baked into the web bundle (VITE_FEEDBACK_URL)"
  type        = string
  default     = ""
}

variable "app_version" {
  description = "Version label shown in the web app (VITE_APP_VERSION)"
  type        = string
  default     = ""
}

variable "allowed_web_origins" {
  description = "Extra exact https://host origins allowed to open /ws; the origin of the page this service serves needs no entry"
  type        = list(string)
  default     = []
}

variable "custom_domain" {
  description = "Custom domain for the web version (external Application Load Balancer + Google-managed cert); empty = none. After apply, add an A record to output custom_domain_ip"
  type        = string
  default     = ""
}

#---------------------------------------------------------------------------------------------------------------------#
# Cost + monitoring
#---------------------------------------------------------------------------------------------------------------------#

variable "billing_account" {
  description = "Billing account id (XXXXXX-XXXXXX-XXXXXX) for the Vertex AI budget alert; empty = no budget"
  type        = string
  default     = ""
}

variable "monthly_budget_thb" {
  description = "Monthly Vertex AI budget in THB (the billing account currency); alerts at 50/90/100 %"
  type        = number
  default     = 0
  validation {
    condition     = var.monthly_budget_thb >= 0 && var.monthly_budget_thb == floor(var.monthly_budget_thb)
    error_message = "monthly_budget_thb must be a whole number >= 0 (Money.units is an integer)."
  }
}

variable "alert_emails" {
  description = "Emails for the budget alert and the cue-error alert"
  type        = list(string)
  default     = []
}

#---------------------------------------------------------------------------------------------------------------------#
# Cloudflare (custom domain)
#---------------------------------------------------------------------------------------------------------------------#

variable "cloudflare_zone_id" {
  description = "Cloudflare zone ID of the custom_domain zone (praneat.com)"
  type        = string
  default     = ""
}

variable "pem_certificate" {
  description = "Path to the Cloudflare Origin Certificate (public) for the LB; needed when custom_domain is set"
  type        = string
  default     = ""
}

variable "pem_private_key" {
  description = "Path to the Cloudflare Origin Certificate private key; needed when custom_domain is set"
  type        = string
  default     = ""
  sensitive   = true
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token (Zone DNS Edit on the custom_domain zone)"
  type        = string
  default     = ""
  sensitive   = true
}
