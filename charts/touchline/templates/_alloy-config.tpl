{{/*
The in-namespace Alloy configuration. Rendered into the ConfigMap and hashed into the Deployment's
checksum/config annotation, so a config change restarts Alloy (it does not watch its config file).
*/}}
{{- define "touchline.alloyConfig" -}}
logging {
	level  = "info"
	format = "logfmt"
}

// Every app in this namespace sends its OTLP here instead of straight to Grafana Cloud, so
// one place holds the Grafana Cloud credential and the Kubernetes enrichment rule.
otelcol.receiver.otlp "apps" {
	grpc {
		endpoint = "0.0.0.0:4317"
	}

	http {
		endpoint = "0.0.0.0:4318"
	}

	output {
		metrics = [otelcol.processor.k8sattributes.apps.input]
		logs    = [otelcol.processor.k8sattributes.apps.input]
		traces  = [otelcol.processor.k8sattributes.apps.input]
	}
}

// Resolves the sending pod from the OTLP connection's source IP and adds its namespace, pod,
// node and owning-deployment identity as resource attributes on every signal. Scoped to this
// release's own namespace: it never needs to watch pods anywhere else, which is what lets the
// RBAC below be a namespaced Role instead of a cluster-wide ClusterRole.
otelcol.processor.k8sattributes "apps" {
	filter {
		namespace = "{{ .Values.namespace }}"
	}

	extract {
		metadata = [
			"k8s.namespace.name",
			"k8s.pod.name",
			"k8s.pod.uid",
			"k8s.node.name",
			"k8s.deployment.name",
		]
	}

	pod_association {
		source {
			from = "connection"
		}
	}

	output {
		metrics = [otelcol.processor.batch.apps.input]
		logs    = [otelcol.processor.batch.apps.input]
		traces  = [otelcol.processor.batch.apps.input]
	}
}

// The apps above only emit OTLP for metrics/traces and a handful of OTel log records; the
// structured JSON lines the dashboards actually query in Loki (`| json | event="generation"`)
// go to container stdout, not OTLP. This second pipeline tails that stdout directly through
// the Kubernetes API (no privileged DaemonSet, no node filesystem access) and feeds it into
// the same batch processor and exporter above, so it reaches Grafana Cloud with the same
// credentials and the same metrics/logs/traces fan-out.
//
// Scoped to this release's own namespace only, the same boundary the k8sattributes processor
// above uses and the same reason the Role above stays namespaced: discovery.kubernetes with
// namespaces.names set calls the namespaced pod list/watch endpoints, never the cluster-wide
// ones, so it needs no ClusterRole.
discovery.kubernetes "pods" {
	role = "pod"

	namespaces {
		names = ["{{ .Values.namespace }}"]
	}
}

discovery.relabel "pods" {
	targets = discovery.kubernetes.pods.targets

	// Defence in depth on top of the namespace scoping above: every pod this chart creates
	// carries app.kubernetes.io/name (touchline.selectorLabels), so this drops any pod a
	// consumer might install into the same namespace outside this chart.
	rule {
		source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
		action        = "keep"
		regex         = ".+"
	}

	// service_name mirrors OTEL_SERVICE_NAME on every Deployment/CronJob in this chart: both
	// are set from the same app.kubernetes.io/name pod label, so a pod's stdout logs and its
	// own OTLP telemetry carry the identical service identity.
	rule {
		source_labels = ["__meta_kubernetes_pod_label_app_kubernetes_io_name"]
		action        = "replace"
		target_label  = "service_name"
	}

	// service_namespace mirrors the service.namespace resource attribute every app sets via
	// OTEL_RESOURCE_ATTRIBUTES (touchline.resourceAttributes); it is a static value, not read
	// off the pod, so no source_labels are needed.
	rule {
		target_label = "service_namespace"
		replacement  = "{{ .Values.namespace }}"
	}

	rule {
		source_labels = ["__meta_kubernetes_namespace"]
		action        = "replace"
		target_label  = "namespace"
	}

	rule {
		source_labels = ["__meta_kubernetes_pod_name"]
		action        = "replace"
		target_label  = "pod"
	}

	rule {
		source_labels = ["__meta_kubernetes_pod_container_name"]
		action        = "replace"
		target_label  = "container"
	}
}

// Tails container stdout/stderr through the Kubernetes API (kubelet log-tailing endpoint,
// proxied by the API server) rather than mounting node log directories, so it needs no
// privileged container and no DaemonSet - see the "pods/log" RBAC rule above. A container
// that exposes more than one port (only this chart's own Alloy container does) is discovered
// once per port and so is tailed more than once; the only effect is a few duplicate lines in
// Alloy's own operational logs, which nothing here dashboards against.
loki.source.kubernetes "pods" {
	targets    = discovery.relabel.pods.output
	forward_to = [otelcol.receiver.loki.pods.receiver]
}

// Bridges the Loki log-entry format above into the OTel logs pipeline. Every Loki label on
// the entry (service_name, service_namespace, namespace, pod, container) arrives as a LOG
// RECORD attribute, not a resource attribute, plus a loki.attribute.labels hint; each entry
// gets its own resource, which is what lets the transform below set resource attributes per
// record without mixing services.
otelcol.receiver.loki "pods" {
	output {
		logs = [otelcol.processor.transform.pod_logs.input]
	}
}

// Moves the underscored record attributes above onto the resource under the dotted OTel
// keys (service.name, service.namespace, k8s.*) that Grafana Cloud's OTLP endpoint promotes to
// the service_name/service_namespace Loki labels the dashboards query. Left as record
// attributes, the stream lands as service_name="unknown_service" with the real name only in
// structured metadata. The apps log JSON with trace_id/span_id, which become the record's
// trace context so trace-to-logs works.
otelcol.processor.transform "pod_logs" {
	error_mode = "ignore"

	log_statements {
		context = "log"
		statements = [
			`set(resource.attributes["service.name"], log.attributes["service_name"])`,
			`set(resource.attributes["service.namespace"], log.attributes["service_namespace"])`,
			`set(resource.attributes["k8s.namespace.name"], log.attributes["namespace"])`,
			`set(resource.attributes["k8s.pod.name"], log.attributes["pod"])`,
			`set(resource.attributes["k8s.container.name"], log.attributes["container"])`,
			`delete_matching_keys(log.attributes, "^(service_name|service_namespace|namespace|pod|container|loki\\..*)$")`,
			`set(log.trace_id.string, ParseJSON(log.body)["trace_id"]) where IsMatch(log.body, "^\\{.*\"trace_id\":\"[0-9a-f]{32}\"")`,
			`set(log.span_id.string, ParseJSON(log.body)["span_id"]) where IsMatch(log.body, "^\\{.*\"span_id\":\"[0-9a-f]{16}\"")`,
		]
	}

	output {
		logs = [otelcol.processor.batch.apps.input]
	}
}

otelcol.processor.batch "apps" {
	output {
		metrics = [otelcol.exporter.otlphttp.grafana_cloud.input]
		logs    = [otelcol.exporter.otlphttp.grafana_cloud.input]
		traces  = [otelcol.exporter.otlphttp.grafana_cloud.input]
	}
}

otelcol.auth.basic "grafana_cloud" {
	username = sys.env("GRAFANA_CLOUD_OTLP_USERNAME")
	password = sys.env("GRAFANA_CLOUD_OTLP_PASSWORD")
}

otelcol.exporter.otlphttp "grafana_cloud" {
	client {
		endpoint = sys.env("GRAFANA_CLOUD_OTLP_ENDPOINT")
		auth     = otelcol.auth.basic.grafana_cloud.handler
	}
}
{{- end -}}
