import apiClient from './api';

class SearchService {
  /**
   * New unified search using the optimized backend endpoint
   * 1 API call instead of 31!
   */
  async searchAll(query) {
    if (!query.trim()) return [];

    try {
      const response = await apiClient.get('/search', {
        params: {
          q: query,
          limit: 50
        }
      });

      // Return results directly from unified endpoint
      return response.data.results || [];
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }

  /**
   * Search with type filtering
   */
  async searchByType(query, types) {
    if (!query.trim()) return [];

    try {
      const response = await apiClient.get('/search', {
        params: {
          q: query,
          types: types.join(','),
          limit: 50
        }
      });

      return response.data.results || [];
    } catch (error) {
      console.error('Search error:', error);
      return [];
    }
  }

  /**
   * Advanced search with severity, status, and date filters
   */
  async searchAdvanced(query, { types, severity, status, dateFrom, dateTo } = {}) {
    if (!query.trim()) return { results: [], total: 0, execution_time: 0 };

    try {
      const params = { q: query, limit: 50 };
      if (types) params.types = Array.isArray(types) ? types.join(',') : types;
      if (severity && severity.length) params.severity = severity.join(',');
      if (status && status.length) params.status = status.join(',');
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;

      const response = await apiClient.get('/search', { params });
      return response.data;
    } catch (error) {
      console.error('Search error:', error);
      return { results: [], total: 0, execution_time: 0 };
    }
  }

  /**
   * Get grouped results
   */
  async searchGrouped(query) {
    if (!query.trim()) return {};

    try {
      const response = await apiClient.get('/search', {
        params: {
          q: query,
          limit: 50
        }
      });

      return response.data.grouped || {};
    } catch (error) {
      console.error('Search error:', error);
      return {};
    }
  }
}

export default new SearchService();
