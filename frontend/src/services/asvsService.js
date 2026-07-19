/**
 * ASVS requirements service — thin wrapper over the shared axios client.
 */
import apiClient from './api';

export const asvsService = {
  // Global static ASVS catalog (assessment-independent). Fetched once to drive
  // the custom-list picker in the create-assessment modal.
  catalog: async () => (await apiClient.get('/asvs/catalog')).data,

  list: async (assessmentId, params = {}) =>
    (await apiClient.get(`/assessments/${assessmentId}/asvs`, { params })).data,

  summary: async (assessmentId) =>
    (await apiClient.get(`/assessments/${assessmentId}/asvs/summary`)).data,

  update: async (assessmentId, reqId, data) =>
    (await apiClient.patch(`/assessments/${assessmentId}/asvs/${reqId}`, data)).data,
};

export default asvsService;
