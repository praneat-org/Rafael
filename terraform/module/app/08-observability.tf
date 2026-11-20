## Log-based metrics on the session-end line `session.stats` (apps/server/src/sessionStats.ts, counts and ms only, D11) ##
## and one alert on sessions that had errors ##

locals {
  stats_filter    = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${var.cloud_run_service_name}\" AND jsonPayload.msg=\"session.stats\""
  latency_buckets = [500, 1000, 2000, 3000, 4000, 5000, 7500, 10000, 20000]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/logging_metric ##
resource "google_logging_metric" "cue_p50" {
  project     = var.project_id
  name        = "${var.project_name}_${var.environment}_cue_p50_ms"
  description = "Per-session cue latency p50 (ms), one point per ended session"
  filter      = local.stats_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  value_extractor = "EXTRACT(jsonPayload.cueP50Ms)"
  bucket_options {
    explicit_buckets {
      bounds = local.latency_buckets
    }
  }

  depends_on = [google_project_service.project_service]
}

resource "google_logging_metric" "cue_p95" {
  project     = var.project_id
  name        = "${var.project_name}_${var.environment}_cue_p95_ms"
  description = "Per-session cue latency p95 (ms), one point per ended session"
  filter      = local.stats_filter

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "ms"
  }
  value_extractor = "EXTRACT(jsonPayload.cueP95Ms)"
  bucket_options {
    explicit_buckets {
      bounds = local.latency_buckets
    }
  }

  depends_on = [google_project_service.project_service]
}

## sessions that logged at least one failed cue ##
resource "google_logging_metric" "cue_error_sessions" {
  project     = var.project_id
  name        = "${var.project_name}_${var.environment}_cue_error_sessions"
  description = "Ended sessions with errorCount > 0"
  filter      = "${local.stats_filter} AND jsonPayload.errorCount>0"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }

  depends_on = [google_project_service.project_service]
}

## https://registry.terraform.io/providers/hashicorp/google/latest/docs/resources/monitoring_alert_policy ##
resource "google_monitoring_alert_policy" "cue_errors" {
  project      = var.project_id
  display_name = "${var.project_name}-${var.environment} sessions with cue errors"
  combiner     = "OR"

  conditions {
    display_name = "error sessions > 0 in 1h"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${google_logging_metric.cue_error_sessions.name}\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  notification_channels = [for c in google_monitoring_notification_channel.email : c.id]

  depends_on = [google_project_service.project_service]
}
