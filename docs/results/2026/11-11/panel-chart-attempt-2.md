# Chart renderer attempt2 — one pass, three observer failures

[Run43061194188](https://github.com/alvarovillalbaa/sift-analytics/actions/runs/43061194188),
job130663915524, ran at24ebf11a85b97e578d409a4a68035171f481c33c.
The frozen production build and pinned Chromium launch passed. C03's exact
integer/text preservation and numeric chart refusals passed. C01/C02/C04 failed
at `latest.ticks.length > 0`, before their remaining renderer/reload checks.
This attempt and its supervisor remain **failed**.

The [desktop](panel-chart-attempt-2/panel-chart-C01.png) and
[narrow](panel-chart-attempt-2/panel-chart-C02.png) screenshots show axis labels
and actual chart paths. The installed locked Recharts3.10.1 CartesianAxis source
renders labels in `recharts-xAxis-tick-labels`, which can be a separately layered
sibling of the axis-line group. The observer queried the old axis ancestor.
The next source corrects only that selector, scrolls the chart into view, and
retains the stable geometry before checking labels. Nonempty/exact-label and
numeric geometry assertions stay mandatory; no application fix is inferred.
These early failure captures do not establish settled appearance of every chart.

[Original packet and checksums](panel-chart-attempt-2/checksums.json) retain all
16 members: four PNGs, full build/install/tool/runtime logs, source manifests,
tool lock, browser results and supervisor JSON. Lossless gzip round-trips retain
every log byte. All230 source inputs independently match the unchanged native
baseline or exact frozen task hashes; source-before and source-after are equal.
Four complete runtime streams match their reported sizes/hashes with EOF and
closed descriptors. Both owned process groups are absent, and no marked process
or process-scan error remains. Every browser context/page closed, network bodies
drained, and its own baseline storage was restored.

The browser's expected nonzero failure exit triggers the supervisor's zero-exit
gate and retains that cleanup failure string. These narrow absence observations
do not turn the overall result green. Docker image/cache cleanup, runner disposal
and host-wide process absence remain unverified. No model/provider, account,
database, production configuration or local build/browser was used.
