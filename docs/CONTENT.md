# Curriculum and content authoring

Prompt Lab teaches clear requirements, deliberate constraints, structured outputs, debugging from evidence, and small application design. Five levels contain twenty published challenges: the ten original foundations plus ten applied machine-learning extensions.

Challenge YAML lives in `packages/content/challenges`. `levels.yaml` defines the roadmap; each other challenge file has a stable slug, level, position, brief, hint, budget, XP, context, optional model run, and check definitions. `daily-overrides.yaml` can pin daily assignments.

1. Edit or add a definition, preserving existing slugs.
2. Include concrete acceptance criteria, starter/failure evidence where useful, and official research references.
3. Add positive/negative examples under `__golden__` and test the actual grading behavior.
4. Run `npm run check`. Open a review before deploying content changes.
5. Synchronize through `npm run release` or the author/admin sync action.

Content synchronization validates keys/configurations and inserts a new immutable version when canonical content changes. Submissions retain their original version. Missing definitions are unpublished rather than deleted. Never overwrite learner history to make a new challenge fit.

## Evaluation policy

Introductory keyword checks are intentionally simple feedback. Higher-level model/output checks evaluate the result or rubric. Applied exercises can accept implementation prompts or code with research notes, as described in their context. A strong request must state concrete behavior; code must substantiate it. Neither keyword repetition nor fabricated execution claims establish correctness. The current phase does not execute submitted or generated code. Treat model feedback as review, not a test-run certificate.

The applied topics include NumPy scaling, classification metrics, pandas missing data, scikit-learn pipelines, model cards, reproducibility, data leakage, repairing tests, inference APIs, and fair model comparison. Definitions link official documentation inside `context.references`. Keep references current during content reviews.

Use the admin dry run to inspect grading without creating submissions or XP; provider usage still counts toward caps. Golden fixtures use scripted providers in tests and cannot establish real-model evaluation quality. Before launch, run a representative real-provider review set with both correct and misleading submissions and record false-positive/false-negative rates.
