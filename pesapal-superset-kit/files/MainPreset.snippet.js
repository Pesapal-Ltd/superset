  WhatIfFilterPlugin,
import { HtmlContentChartPlugin } from '@superset-ui/plugin-chart-html-content';
import { ZohoKpiChartPlugin } from '@superset-ui/plugin-chart-zoho-kpi';
import { SmartNarrativeChartPlugin } from '@superset-ui/plugin-chart-smart-narrative';
import { PivotProChartPlugin } from '@superset-ui/plugin-chart-pivot-pro';
import { DecompositionTreeChartPlugin } from '@superset-ui/plugin-chart-decomposition-tree';
import { KeyInfluencersChartPlugin } from '@superset-ui/plugin-chart-key-influencers';
import { WhatIfScenarioChartPlugin } from '@superset-ui/plugin-chart-what-if';
        new WhatIfFilterPlugin().configure({ key: FilterPlugins.WhatIf }),
        new HtmlContentChartPlugin().configure({ key: 'html_content' }),
        new ZohoKpiChartPlugin().configure({ key: 'zoho_kpi' }),
        new SmartNarrativeChartPlugin().configure({ key: 'smart_narrative' }),
        new PivotProChartPlugin().configure({ key: 'pivot_pro' }),
        new DecompositionTreeChartPlugin().configure({
          key: 'decomposition_tree',
        }),
        new KeyInfluencersChartPlugin().configure({ key: 'key_influencers' }),
        new WhatIfScenarioChartPlugin().configure({ key: 'what_if_scenario' }),
