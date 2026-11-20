# Pesapal Superset extensions – deployment kit

Everything built on the dev Superset, packaged so it can be installed on the company Superset
(any environment: Docker, Kubernetes/Helm, VMs).

| What | Where it shows up |
|---|---|
| **Zoho KPI** (`zoho_kpi`) | Chart type |
| **HTML Content** (`html_content`) – paste a full HTML page, data in `window.supersetData`; hidden pages + back links; viewer filters | Chart type |
| **Smart Narrative** (`smart_narrative`) – auto-generated commentary | Chart type |
| **Pivot Table Pro** (`pivot_pro`) – Zoho-style pivot, conditional formatting, click-to-format, locked on dashboards, viewer filters | Chart type |
| **Decomposition Tree** (`decomposition_tree`) | Chart type |
| **Key Influencers** (`key_influencers`) | Chart type |
| **What-if Scenario** (`what_if_scenario`) | Chart type |
| **What-if parameter** (`filter_whatif`) – slider that feeds DAX measures | Dashboard filter type |
| **Semantic Model** page – DAX measures, star-schema relationships, what-if parameters | Top menu → *Semantic Model* (`/semantic/`) |

Nothing new is stored in the metadata database schema: no migrations. Measures, models and
parameters live in existing dataset fields, chart settings in normal chart params.

## Kit contents

```
install.py                          copies the code into a Superset checkout and makes the core edits
files/                              all the code, laid out like the Superset repo
  superset-frontend/plugins/plugin-chart-*   the 7 chart plugins
  superset-frontend/src/features/semantic    DAX parser/compiler, semantic model logic
  superset-frontend/src/pages/SemanticModel  Semantic Model page
  superset-frontend/src/filters/components/WhatIf   what-if dashboard filter
  superset/semantic                          Python: Jinja helpers for DAX, the /semantic/ page view
  tests/unit_tests/semantic                  Python tests
  MainPreset.snippet.js                      the chart registrations (for manual installs)
config/superset_config_additions.py  settings to add to superset_config.py
helm/values-pesapal.yaml             the same settings for the official Helm chart
docker/build.sh                      build + smoke-test the image
```

## Compatibility

Tested by installing into clean Superset checkouts, then type-checking the whole frontend and
running the 145 frontend tests (25 suites):

| Superset | Installer | Type check | Tests |
|---|---|---|---|
| 4.1.2 | ✓ | ✓ | 145/145 |
| 5.0.0 | ✓ | ✓ | 145/145 |
| 6.1.0 | ✓ (auto-adapts, see below) | ✓ | 145/145 |
| master (Nov 2026) | ✓ | not run | not run |

Superset 6 moved `t`, `styled`, `useTheme`… to `@apache-superset/core` and replaced the theme
colours with Ant Design tokens. `install.py` detects Superset 6 and rewrites the copied code
for it automatically (imports, theme tokens, plugin `tsconfig.json`, root `tsconfig.json`
references). On 4.x/5.x the code is copied unchanged.

## Step by step

### 1. Get the source of the Superset version the company runs

Check the version (Settings → About). Then, if the company already keeps a fork, use it;
otherwise:

```bash
git clone --branch 5.0.0 https://github.com/apache/superset.git company-superset
cd company-superset && git checkout -b pesapal-extensions
```

### 2. Install the extensions

```bash
python3 /path/to/pesapal-superset-kit/install.py /path/to/company-superset --check   # dry run
python3 /path/to/pesapal-superset-kit/install.py /path/to/company-superset
```

It copies `files/` and edits 6 core files (`package.json`, `src/constants.ts`,
`src/filters/components/index.ts`, `src/views/routes.tsx`, `MainPreset.js|ts`,
`superset/initialization/__init__.py`). It is safe to run again. If it prints lines starting
with `!`, see *Manual edits* below.

### 3. Check it (optional but recommended – same checks as Superset's CI)

```bash
cd company-superset/superset-frontend
npm install
npm run plugins:build            # Superset 6 only
npm run type                     # or: npx tsc --noEmit
npx jest plugins/plugin-chart-html-content plugins/plugin-chart-zoho-kpi \
  plugins/plugin-chart-smart-narrative plugins/plugin-chart-pivot-pro \
  plugins/plugin-chart-decomposition-tree plugins/plugin-chart-key-influencers \
  plugins/plugin-chart-what-if src/features/semantic src/pages/SemanticModel \
  src/filters/components/WhatIf
cd .. && pytest tests/unit_tests/semantic
```

Commit the result (including the updated `superset-frontend/package-lock.json`).

### 4. Build the image

```bash
/path/to/pesapal-superset-kit/docker/build.sh /path/to/company-superset \
    registry.example.com/pesapal/superset 5.0.0-pesapal.1 --push
```

This updates the lockfile, builds the production (`lean`) image with the frontend compiled in,
checks the backend module and the new charts are inside, and pushes it.

### 5. Configuration

Add `config/superset_config_additions.py` to the end of the production `superset_config.py`
(or `python3 install.py <src> --config /path/to/superset_config.py`).
With Helm, use `helm/values-pesapal.yaml` (`configOverrides`). It turns on
`ENABLE_TEMPLATE_PROCESSING` and registers the `dax_*` Jinja helpers used by DAX measures and
what-if parameters. Everything else works without it, but DAX measures will not.

### 6. Deploy

Point the web server, Celery workers and Celery beat at the new image and restart them, then run
once:

```bash
superset init        # registers the "Semantic Model" menu permission
```

- Docker Compose: change `image:` to the new tag, `docker compose up -d`.
- Helm: `helm upgrade superset superset/superset -f values.yaml -f values-pesapal.yaml`
  (the chart's init job runs `superset init`).

### 7. Permissions

| Who | Needs |
|---|---|
| Sees the *Semantic Model* menu | `menu access on Semantic Model` + `can read on Dataset` (Admin gets them from `superset init`) |
| Saves measures / parameters | `can write on Dataset` and must be an owner of the dataset (or Admin) |
| Builds a star-schema model | the above + `can execute sql query on SQLLab` and access to the database |
| Uses the what-if slider on a dashboard | `can read on Dataset` (Gamma has it) + access to the dataset |
| Views the new charts | nothing extra – normal dashboard/chart/datasource access |

### 8. Move dashboards, charts and models from dev

Dashboards → select → *Export* on dev, *Import* on the company server (or Datasets → Export for
just the models). DAX measures, parameters and star-schema definitions are stored on the
datasets, so they travel with them. Database connections must exist on the target with the same
name (passwords are asked during import).

## Security notes

- `ENABLE_TEMPLATE_PROCESSING` also enables Jinja in SQL Lab and virtual datasets for everyone
  who can write SQL. That is standard Superset behaviour; review it with whoever owns security.
  The `dax_*` helpers only format numbers / build `OVER (...)` clauses from the chart's own
  columns; what-if values go through `dax_num`, which only lets numbers through.
- HTML Content pages run in a sandboxed iframe without same-origin access (they cannot read
  Superset cookies or call the Superset API). Production Superset sends a Content Security
  Policy (`TALISMAN_CONFIG`); if a page loads images, fonts or scripts from other sites, add
  those hosts to `img-src` / `font-src` / `script-src`. Test the pages on staging first.

## Limitations of the DAX layer

See `files/superset/semantic/README.md` (supported functions, how it maps to SQL). In short:
dashboard filters apply first (`ALL` behaves like `ALLSELECTED`); time intelligence needs the
date column on the chart; exact date shifts on PostgreSQL / Redshift / Snowflake / DuckDB,
row-based on other databases; no `VAR`/`RETURN`, `SUMMARIZE`, `USERELATIONSHIP` yet.

## Upgrading Superset later

Check out the new Superset version and run `install.py` on it again, then steps 3–6.
Existing charts, dashboards and measures keep working (their settings are unchanged).

## Rolling back

Deploy the previous image. Dashboards keep the new charts, but those charts show
"unknown chart type" until the extensions are back; datasets, measures and data are unaffected.

## Manual edits (only if install.py printed `!` lines)

| File | Add |
|---|---|
| `superset-frontend/package.json` → `dependencies` | `"@superset-ui/plugin-chart-<name>": "file:./plugins/plugin-chart-<name>"` for the 7 plugins |
| `src/constants.ts` → `enum FilterPlugins` | `WhatIf = 'filter_whatif',` |
| `src/filters/components/index.ts` | `export { default as WhatIfFilterPlugin } from './WhatIf';` |
| `src/views/routes.tsx` | `const SemanticModel = lazy(() => import('src/pages/SemanticModel'));` and `{ path: '/semantic/', Component: SemanticModel }` in `routes` |
| `src/visualizations/presets/MainPreset.(js\|ts)` | the imports and `new …Plugin().configure(...)` lines from `files/MainPreset.snippet.js` |
| `superset/initialization/__init__.py` → `init_views` | `from superset.semantic.views import SemanticModelView`, `appbuilder.add_view_no_menu(SemanticModelView)`, and `appbuilder.add_link("Semantic Model", label=__("Semantic Model"), href=f"{app_root}/semantic/", icon="fa-cubes", category="", category_icon="")` after the Datasets link |

## Troubleshooting

| Symptom | Fix |
|---|---|
| New charts missing from the chart picker | Image built from a checkout without the edits, or old assets cached: hard refresh; check the smoke test in `build.sh` |
| Docker build fails at `npm ci` | `package-lock.json` not updated: run `npm install` in `superset-frontend` and commit |
| *Semantic Model* not in the menu | Run `superset init`; grant `menu access on Semantic Model` to the role |
| DAX measure errors with `'dax_over' is undefined` | Config from step 5 missing, or web/worker not restarted |
| What-if slider has no effect | The filter must target the dataset's `whatif_…` column, and the chart must use a measure that references the parameter |
| HTML page shows blank images/fonts from other sites | Add the hosts to `TALISMAN_CONFIG` (see Security notes) |
