# Real-Surface Smoke Pipeline

This is the unstable/live companion to the controlled cowork smoke.

Run:

```bash
npm --prefix app run smoke:real-surfaces
```

Default config path:

```text
app/.runtime-data/validation/real-surfaces/real-surface-smoke.local.json
```

or set:

```text
COWORK_REAL_SURFACE_SMOKE_CONFIG_PATH=<path>
```

Example:

```json
{
  "targets": {
    "canvas": {
      "url": "https://example.org/canvas-page",
      "minCanvasCount": 1
    },
    "pdf": {
      "url": "https://example.org/public.pdf"
    },
    "dropdown": {
      "url": "https://example.org/test-form",
      "selectSelector": "select[name='region']",
      "optionValue": "eu",
      "expectedTextSelector": "#selected-region"
    },
    "networkError": {
      "url": "https://example.invalid/",
      "expectFailure": true,
      "timeoutMs": 5000
    },
    "slowPage": {
      "url": "https://example.org/slow",
      "readySelector": "#ready",
      "timeoutMs": 20000,
      "minElapsedMs": 1000
    }
  },
  "operatorResearch": {
    "enabled": true,
    "mission": "Compare the allowlisted public pages and produce a traceable note.",
    "targets": [
      {
        "title": "Target A",
        "url": "https://example.com/",
        "fieldMap": {
          "companyName": { "css": "h1" }
        }
      },
      {
        "title": "Target B",
        "url": "https://example.org/",
        "fieldMap": {
          "companyName": { "css": "h1" }
        }
      }
    ]
  }
}
```

Missing targets are reported as `blocked`, not `fail`, so the backoffice can distinguish missing live validation setup from actual product failures.
