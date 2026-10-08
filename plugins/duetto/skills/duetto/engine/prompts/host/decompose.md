# Host step: decompose the request into features
Using the request and both scans, split the work into independently shippable features with explicit dependencies (ids F1, F2, …; kebab-case slugs). Small requests should be ONE feature. Each feature must be reviewable as its own PR. If the user gave feedback on a previous split, apply it.
