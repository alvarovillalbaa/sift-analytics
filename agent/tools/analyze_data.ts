import { defineTool } from 'eve/tools';
import { analysisPlanSchema, validatedAnalysisPlan } from '../lib/plans';

export default defineTool({
  description: 'Plan up to six read-only analytical queries over the shared approved datasets. The browser executes them. Numerical insights require returned execution evidence with result sharing enabled.',
  inputSchema: analysisPlanSchema,
  execute: validatedAnalysisPlan,
});
