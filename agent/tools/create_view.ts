import { defineTool } from 'eve/tools';
import { validatedViewPlan, viewPlanSchema } from '../lib/plans';

export default defineTool({
  description: 'Create a validated dashboard plan using the exact shared dataset schemas and approved metric definitions. Returns panels for the browser to execute; it does not execute SQL or return analytical results.',
  inputSchema: viewPlanSchema,
  execute: validatedViewPlan,
});
