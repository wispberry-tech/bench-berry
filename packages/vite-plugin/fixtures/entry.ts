import cfg from 'virtual:berrybench-config';
import api from 'virtual:berrybench-snapshots/api';
console.log(JSON.stringify({ enabled: cfg.workspaces.api.enabled, endpointCount: api.endpointCount, title: api.title }));