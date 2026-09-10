import { z } from 'zod';
import { accountSchema, healthSchema, overviewSchema, providerIdSchema, snapshotSchema } from '../core/types.js';
import { channelConfigurationSchema, channelSaveSchema, secretSaveSchema } from './channels.js';
export const filterSchema = z.array(providerIdSchema).max(7).optional();
const codec = (schema: z.ZodType, type: string) => ({mode:'strict' as const, typeSymbol:`dsh-ai-meter#${type}`, schema});
const parameter = (name: string, schema: z.ZodType) => ({
  name, wire:name, source:'json' as const, codec:codec(schema, name),
  ...(schema.safeParse(undefined).success ? {acceptsUndefined:true as const} : {}),
});
const providersSchema = z.array(z.object({id:providerIdSchema, name:z.string(), detected:z.boolean(), accounts:z.array(accountSchema)}));
const healthResult = z.array(z.object({provider:providerIdSchema, account:z.string(), health:healthSchema}));
const filter = parameter('filter', filterSchema);
const methods = [
  {method:'getUsageView',parameters:[parameter('preview',z.boolean()),parameter('force',z.boolean()),parameter('collect',z.boolean())],schema:overviewSchema},
  {method:'testConnection', parameters:[parameter('provider',providerIdSchema),parameter('account',z.string())], schema:snapshotSchema},
  {method:'discoverLocal', parameters:[], schema:z.array(providerIdSchema)},
  {method:'getPreview', parameters:[], schema:overviewSchema},
  {method:'getConfiguration', parameters:[], schema:channelConfigurationSchema},
  {method:'saveConfiguration', parameters:[parameter('input', channelSaveSchema)], schema:channelConfigurationSchema},
  {method:'setCredential', parameters:[parameter('input', secretSaveSchema)], schema:channelConfigurationSchema},
  {method:'listProviders', parameters:[], schema:providersSchema},
  {method:'getUsage', parameters:[parameter('provider', providerIdSchema), parameter('account', z.string().optional())], schema:snapshotSchema},
  {method:'getAllUsage', parameters:[filter], schema:overviewSchema},
  {method:'refresh', parameters:[filter], schema:overviewSchema},
  {method:'getHealth', parameters:[filter], schema:healthResult},
  {method:'getAvailableProviders', parameters:[filter], schema:healthResult},
];
export const descriptors = methods.map(({method, parameters, schema}) => ({
  id:`dsh-ai-meter#aiMeter/${method}`, service:'aiMeter', namespace:'aiMeter', method,
  invocation:{kind:'direct' as const}, parameters, result:codec(schema, `${method}Result`),
}));
export const TYPERT = {package:'dsh-ai-meter', face:'host', schemas:[], invocations:descriptors, model:{services:[], events:[], objects:[]}};
