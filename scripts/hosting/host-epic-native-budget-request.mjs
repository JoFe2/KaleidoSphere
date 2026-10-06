// Trusted owner caller construction only; not a schema, provider permission,
// runtime qualification or activation grant. Product guards stay authoritative.
export function buildHostEpicNativeBudgetRequestV1(seed,template){
 if(template.resourceClass.maxRequests<2)throw new Error('H282_TWO_LOCAL_REQUESTS_OUTSIDE_HELD_TEMPLATE');
 const budget={...seed.budget,maxRequests:2};
 for(const key of ['maxInputBytes','maxOutputBytes','maxTokens','timeoutMs'])
  budget[key]=Math.min(seed.budget[key],template.resourceClass[key]);
 return {...seed,budget,attachments:[],tools:[],operationId:'operation:epic282-native-model-001',correlationId:'correlation:epic282-native-model-001'};
}
