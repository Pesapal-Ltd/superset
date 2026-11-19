#!/usr/bin/env python3
"""
Install the Pesapal Superset extensions into a Superset source checkout.

    python3 install.py /path/to/superset              # copy files + edit core files
    python3 install.py /path/to/superset --check      # only report what would change
    python3 install.py /path/to/superset --config /path/to/superset_config.py

Safe to run more than once: every step checks whether it is already done.
Each core edit looks for a known line in the Superset source; if a line is not found
(older/newer Superset) the script tells you exactly what to add by hand.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from collections import OrderedDict
from pathlib import Path

KIT = Path(__file__).resolve().parent
FILES = KIT / "files"

PLUGINS = OrderedDict(
    [
        # package folder              (export name,                   viz key)
        ("plugin-chart-html-content", ("HtmlContentChartPlugin", "html_content")),
        ("plugin-chart-zoho-kpi", ("ZohoKpiChartPlugin", "zoho_kpi")),
        ("plugin-chart-smart-narrative", ("SmartNarrativeChartPlugin", "smart_narrative")),
        ("plugin-chart-pivot-pro", ("PivotProChartPlugin", "pivot_pro")),
        ("plugin-chart-decomposition-tree", ("DecompositionTreeChartPlugin", "decomposition_tree")),
        ("plugin-chart-key-influencers", ("KeyInfluencersChartPlugin", "key_influencers")),
        ("plugin-chart-what-if", ("WhatIfScenarioChartPlugin", "what_if_scenario")),
    ]
)

COPY_DIRS = [
    *[f"superset-frontend/plugins/{p}" for p in PLUGINS],
    "superset-frontend/src/features/semantic",
    "superset-frontend/src/pages/SemanticModel",
    "superset-frontend/src/filters/components/WhatIf",
    "superset/semantic",
    "tests/unit_tests/semantic",
]

# Superset 6 moved some exports from @superset-ui/core into @apache-superset/core/<module>
V6_MOVED = {
    "t": "translation",
    "tn": "translation",
    "styled": "theme",
    "useTheme": "theme",
    "css": "theme",
    "SupersetTheme": "theme",
    "supersetTheme": "theme",
    "ThemeProvider": "theme",
    "GenericDataType": "common",
}
V6_IMPORT = re.compile(r"import\s+(type\s+)?\{([^}]*)\}\s+from\s+'@superset-ui/core';\n")

# Superset 6 replaced the theme object (colors/gridUnit/typography) with Ant Design tokens
V6_THEME = {
    "gridUnit": "sizeUnit",
    "colors.grayscale.dark2": "colorText",
    "colors.grayscale.dark1": "colorText",
    "colors.grayscale.base": "colorTextSecondary",
    "colors.grayscale.light1": "colorTextTertiary",
    "colors.grayscale.light2": "colorBorder",
    "colors.grayscale.light3": "colorBorderSecondary",
    "colors.grayscale.light4": "colorBgLayout",
    "colors.grayscale.light5": "colorBgContainer",
    "colors.primary.dark2": "colorPrimaryTextActive",
    "colors.primary.dark1": "colorPrimaryActive",
    "colors.primary.base": "colorPrimary",
    "colors.primary.light1": "colorPrimaryHover",
    "colors.primary.light2": "colorPrimaryBorder",
    "colors.primary.light3": "colorPrimaryBorderHover",
    "colors.primary.light4": "colorPrimaryBgHover",
    "colors.primary.light5": "colorPrimaryBg",
    "colors.error.dark1": "colorErrorText",
    "colors.error.base": "colorError",
    "colors.error.light2": "colorErrorBg",
    "colors.success.dark2": "colorSuccessTextActive",
    "colors.success.dark1": "colorSuccessText",
    "colors.success.base": "colorSuccess",
    "colors.success.light2": "colorSuccessBg",
    "colors.warning.dark1": "colorWarningText",
    "colors.warning.base": "colorWarning",
    "colors.warning.light2": "colorWarningBg",
    "typography.weights.bold": "fontWeightStrong",
    "typography.weights.normal": "fontWeightNormal",
    "typography.sizes.xs": "fontSizeXS",
    "typography.sizes.s": "fontSizeSM",
    "typography.sizes.m": "fontSize",
    "typography.sizes.l": "fontSizeLG",
    "typography.sizes.xl": "fontSizeXL",
    "typography.families.sansSerif": "fontFamily",
    "typography.families.monospace": "fontFamilyCode",
}
V6_THEME_RE = re.compile(
    r"\b(theme|supersetTheme)\.("
    + "|".join(re.escape(k) for k in sorted(V6_THEME, key=len, reverse=True))
    + r")\b"
)

CONFIG_SNIPPET = (KIT / "config" / "superset_config_additions.py").read_text()


class Installer:
    def __init__(self, root: Path, check: bool):
        self.root = root
        self.check = check
        self.done: list[str] = []
        self.manual: list[str] = []

    # ---------------------------------------------------------------- helpers
    def path(self, rel: str) -> Path:
        return self.root / rel

    def edit(self, rel: str, fn) -> None:
        p = self.path(rel)
        if not p.exists():
            self.manual.append(f"{rel}: file not found")
            return
        old = p.read_text()
        new = fn(old, rel)
        if new is not None and new != old and rel.endswith(".py"):
            try:  # never write a Python file that no longer compiles
                compile(new, rel, "exec")
            except SyntaxError as exc:
                self.manual.append(f"{rel}: automatic edit failed ({exc}); add the lines by hand")
                return
        if new is not None and new != old:
            if not self.check:
                p.write_text(new)
            self.done.append(f"edited {rel}")

    def insert(self, text, rel, *, marker, add, after=None, before=None, regex=False, hint=""):
        """Insert `add` after/before an anchor unless `marker` is already present."""
        if marker in text:
            return text
        anchor = after if after is not None else before
        if regex:
            m = re.search(anchor, text, flags=re.M)
            pos = (m.end() if after is not None else m.start()) if m else -1
        else:
            i = text.find(anchor)
            pos = (i + len(anchor) if after is not None else i) if i >= 0 else -1
        if pos < 0:
            self.manual.append(f"{rel}: add {hint or repr(add.strip())}")
            return text
        return text[:pos] + add + text[pos:]

    # ---------------------------------------------------------------- steps
    @property
    def is_v6(self) -> bool:
        return (self.root / "superset-frontend/packages/superset-core/src/translation").exists()

    @staticmethod
    def v6_imports(text: str) -> str:
        """Rewrite `import { t, styled, ... } from '@superset-ui/core'` for Superset 6."""

        def fix(m: re.Match) -> str:
            type_kw = m.group(1) or ""
            names = [n.strip() for n in m.group(2).split(",") if n.strip()]
            keep, moved = [], {}
            for n in names:
                base = n.replace("type ", "").split(" as ")[0].strip()
                if base in V6_MOVED:
                    moved.setdefault(V6_MOVED[base], []).append(n)
                else:
                    keep.append(n)
            if not moved:
                return m.group(0)
            out = ""
            if keep:
                out += f"import {type_kw}{{ {', '.join(keep)} }} from '@superset-ui/core';\n"
            for mod, ns in moved.items():
                out += f"import {type_kw}{{ {', '.join(ns)} }} from '@apache-superset/core/{mod}';\n"
            return out

        return V6_IMPORT.sub(fix, text)

    def superset6(self) -> None:
        if not self.is_v6:
            return
        fe = self.root / "superset-frontend"
        # a) imports that moved to @apache-superset/core
        changed = 0
        for rel in COPY_DIRS:
            if not rel.startswith("superset-frontend/"):
                continue
            for f in (self.root / rel).rglob("*"):
                if f.suffix in (".ts", ".tsx", ".js", ".jsx") and f.is_file():
                    old = f.read_text()
                    new = V6_THEME_RE.sub(lambda m: f"{m.group(1)}.{V6_THEME[m.group(2)]}", self.v6_imports(old))
                    if new != old:
                        changed += 1
                        if not self.check:
                            f.write_text(new)
        self.done.append(f"Superset 6: updated imports and theme tokens in {changed} files")
        # b) per-plugin tsconfig in the Superset 6 format (same as the built-in handlebars plugin)
        template = fe / "plugins/plugin-chart-handlebars/tsconfig.json"
        if template.exists():
            for pkg in PLUGINS:
                if not self.check:
                    shutil.copyfile(template, fe / "plugins" / pkg / "tsconfig.json")
            self.done.append("Superset 6: plugin tsconfig.json files")
        # c) declare the new core package used by the rewritten imports
        for pkg in PLUGINS:
            pj = fe / "plugins" / pkg / "package.json"
            data = json.loads(pj.read_text(), object_pairs_hook=OrderedDict)
            peers = data.setdefault("peerDependencies", OrderedDict())
            if "@apache-superset/core" not in peers:
                peers["@apache-superset/core"] = "*"
                data["peerDependencies"] = OrderedDict(sorted(peers.items()))
                if not self.check:
                    pj.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
        # d) project references in the root tsconfig
        refs = "".join(f'    {{ "path": "./plugins/{pkg}" }},\n' for pkg in PLUGINS)
        self.edit(
            "superset-frontend/tsconfig.json",
            lambda t, r: self.insert(
                t, r, marker='"./plugins/plugin-chart-what-if"', add=refs,
                after=r'^\s*\{ "path": "\./plugins/plugin-chart-echarts" \},\n', regex=True,
                hint='{ "path": "./plugins/plugin-chart-<name>" } for each new plugin in "references"',
            ),
        )

    def copy_files(self) -> None:
        for rel in COPY_DIRS:
            src, dst = FILES / rel, self.path(rel)
            if not src.exists():
                sys.exit(f"kit is incomplete: missing {src}")
            if not self.check:
                if dst.exists():
                    shutil.rmtree(dst)
                shutil.copytree(
                    src, dst, ignore=shutil.ignore_patterns("__pycache__", ".DS_Store", "node_modules", "lib", "esm")
                )
            self.done.append(f"copied {rel}")

    def package_json(self) -> None:
        def fn(text, rel):
            data = json.loads(text, object_pairs_hook=OrderedDict)
            deps = data.setdefault("dependencies", OrderedDict())
            missing = [p for p in PLUGINS if f"@superset-ui/{p}" not in deps]
            if not missing:
                return text
            for p in missing:
                deps[f"@superset-ui/{p}"] = f"file:./plugins/{p}"
            data["dependencies"] = OrderedDict(sorted(deps.items()))
            return json.dumps(data, indent=2, ensure_ascii=False) + "\n"

        self.edit("superset-frontend/package.json", fn)

    def constants(self) -> None:
        self.edit(
            "superset-frontend/src/constants.ts",
            lambda t, r: self.insert(
                t, r, marker="filter_whatif", add="  WhatIf = 'filter_whatif',\n",
                after=r"export enum FilterPlugins \{[^}]*?\n(?=\})", regex=True,
                hint="WhatIf = 'filter_whatif', inside enum FilterPlugins",
            ),
        )

    def filter_index(self) -> None:
        def fn(t, r):
            if "WhatIfFilterPlugin" in t:
                return t
            return t.rstrip("\n") + "\nexport { default as WhatIfFilterPlugin } from './WhatIf';\n"

        self.edit("superset-frontend/src/filters/components/index.ts", fn)

    def routes(self) -> None:
        def lazy_block(fn_name: str) -> str:
            return (
                f"const SemanticModel = {fn_name}(\n  () =>\n"
                "    import(/* webpackChunkName: \"SemanticModel\" */ 'src/pages/SemanticModel'),\n);\n\n"
            )
        route = "  {\n    path: '/semantic/',\n    Component: SemanticModel,\n  },\n"

        def fn(t, r):
            m = re.search(r"^const ChartList = (lazy\w*)\(", t, flags=re.M)
            t = self.insert(t, r, marker="const SemanticModel = ", add=lazy_block(m.group(1) if m else "lazy"),
                            before=r"^const ChartList = lazy\w*\(", regex=True,
                            hint="a lazy import: const SemanticModel = lazy(() => import('src/pages/SemanticModel'))")
            t = self.insert(t, r, marker="path: '/semantic/'", add=route,
                            after=r"export const routes: Routes = \[\n", regex=True,
                            hint="{ path: '/semantic/', Component: SemanticModel } to the routes array")
            return t

        self.edit("superset-frontend/src/views/routes.tsx", fn)

    def main_preset(self) -> None:
        imports = "".join(
            f"import {{ {name} }} from '@superset-ui/{pkg}';\n" for pkg, (name, _) in PLUGINS.items()
        )
        def reg(name: str, key: str) -> str:
            line = f"        new {name}().configure({{ key: {key} }}),\n"
            if len(line) <= 81:  # prettier print width 80 (+ newline)
                return line
            return f"        new {name}().configure({{\n          key: {key},\n        }}),\n"

        registrations = reg("WhatIfFilterPlugin", "FilterPlugins.WhatIf") + "".join(
            reg(name, f"'{key}'") for name, key in PLUGINS.values()
        )

        def fn(t, r):
            t = self.insert(t, r, marker="  WhatIfFilterPlugin,", add="  WhatIfFilterPlugin,\n",
                            after="  TimeGrainFilterPlugin,\n",
                            hint="WhatIfFilterPlugin to the import from 'src/filters/components'")
            t = self.insert(t, r, marker="@superset-ui/plugin-chart-what-if", add=imports,
                            before=r"^import TimeTableChartPlugin from '\.\./TimeTable';", regex=True,
                            hint="the 7 plugin imports (see files/MainPreset.snippet.js)")
            t = self.insert(t, r, marker="new WhatIfScenarioChartPlugin()", add=registrations,
                            after=r"new TimeGrainFilterPlugin\(\)\.configure\(\{[^}]*\}\),\n", regex=True,
                            hint="the plugin registrations (see files/MainPreset.snippet.js)")
            return t

        rel = "superset-frontend/src/visualizations/presets/MainPreset.js"
        if not self.path(rel).exists():  # newer Superset uses TypeScript here
            rel = rel[:-3] + ".ts"
        self.edit(rel, fn)

    def initialization(self) -> None:
        def link(t: str) -> str:
            # Use whatever name the file binds lazy_gettext to (`__` in older
            # Superset releases, `_` in newer ones).
            m = re.search(r"lazy_gettext as (\w+)", t)
            gettext = m.group(1) if m else "__"
            return (
                "        appbuilder.add_link(\n"
                '            "Semantic Model",\n'
                f'            label={gettext}("Semantic Model"),\n'
                '            href=f"{app_root}/semantic/",\n'
                '            icon="fa-cubes",\n'
                '            category="",\n'
                '            category_icon="",\n'
                "        )\n"
            )

        def fn(t, r):
            t = self.insert(t, r, marker="from superset.semantic.views import SemanticModelView",
                            add="        from superset.semantic.views import SemanticModelView\n",
                            before=r"^ +from superset\.sqllab\.api import SqlLabRestApi\n", regex=True,
                            hint="from superset.semantic.views import SemanticModelView (in init_views)")
            # menu link right after the "Datasets" link
            t = self.insert(t, r, marker='"Semantic Model"', add=link(t),
                            after=r'appbuilder\.add_link\(\n\s+"Datasets",(?s:.*?)\n        \)\n', regex=True,
                            hint="appbuilder.add_link('Semantic Model', href=f'{app_root}/semantic/', ...)")
            t = self.insert(t, r, marker="add_view_no_menu(SemanticModelView)",
                            add="        appbuilder.add_view_no_menu(SemanticModelView)\n",
                            after="        appbuilder.add_view_no_menu(DatasetEditor)\n",
                            hint="appbuilder.add_view_no_menu(SemanticModelView)")
            return t

        self.edit("superset/initialization/__init__.py", fn)

    def config(self, cfg: Path | None) -> None:
        if cfg is None:
            return
        text = cfg.read_text() if cfg.exists() else ""
        if "superset.semantic" in text:
            return
        if not self.check:
            cfg.write_text(text.rstrip("\n") + "\n\n" + CONFIG_SNIPPET)
        self.done.append(f"appended settings to {cfg}")

    def run(self, cfg: Path | None) -> int:
        if not (self.root / "superset-frontend" / "package.json").exists():
            sys.exit(f"{self.root} does not look like a Superset source checkout")
        self.copy_files()
        self.superset6()
        self.package_json()
        self.constants()
        self.filter_index()
        self.routes()
        self.main_preset()
        self.initialization()
        self.config(cfg)
        print(("Would do" if self.check else "Done") + f" ({len(self.done)} steps):")
        for d in self.done:
            print("  -", d)
        if self.manual:
            print("\nCould not find where to add these; please add by hand (see README, 'Manual edits'):")
            for m in self.manual:
                print("  !", m)
            return 1
        print("\nNext: cd superset-frontend && npm install   (then build the image, see README)")
        return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("superset_root", type=Path)
    ap.add_argument("--check", action="store_true", help="report only, change nothing")
    ap.add_argument("--config", type=Path, help="superset_config.py to append the required settings to")
    a = ap.parse_args()
    sys.exit(Installer(a.superset_root.resolve(), a.check).run(a.config))
