// Compatibility transport for the separate fields report. No enable/disable state.
globalThis.YouTrackFeature=Object.freeze({ready:Promise.resolve(),enabled:true,assert(){},fetch:(...args)=>YouTrackReferenceNetwork.fetch(...args)});
