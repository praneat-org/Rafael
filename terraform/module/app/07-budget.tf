## Monthly budget alert on Vertex AI spend (CAR-3845). Covers Gemini LLM and Gemini STT, both billed as Vertex AI (D20, D22) ##
## Empty billing_account = no budget. The amount must be in the billing account's currency (THB) ##

data "google_project" "this" {
  project_id = var.project_id
}

## Shared by the budget and the cue-error alert policy ##
resource "google_monitoring_notification_channel" "email" {
  for_each = toset(var.alert_emails)

  project      = var.project_id
  display_name = "${var.project_name}-${var.environment} ${each.value}"
  type         = "email"
  labels       = { email_address = each.value }

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/billing_budget ##
resource "google_billing_budget" "vertex" {
  count = var.billing_account == "" ? 0 : 1

  billing_account = var.billing_account
  display_name    = "${var.project_name}-${var.environment} Vertex AI monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
    # Vertex AI service id in Cloud Billing; if the alert never fires, check it in Billing > Reports > filter by service
    services = ["services/C7E2-9256-1C43"]
  }

  amount {
    specified_amount {
      currency_code = "THB"
      units         = tostring(var.monthly_budget_thb)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.9, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }

  all_updates_rule {
    monitoring_notification_channels = [for c in google_monitoring_notification_channel.email : c.id]
    disable_default_iam_recipients   = true
  }

  depends_on = [google_project_service.project_service]
}
