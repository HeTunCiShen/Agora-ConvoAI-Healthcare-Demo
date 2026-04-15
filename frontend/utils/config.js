const CONFIG = {
    API_BASE_URL: window.location.origin,
    DEFAULT_USER_NAME: 'User',
    // Authentication credentials for API access
    // These should be set via environment variables in your deployment
    AUTH_USERNAME: window.APP_AUTH_USERNAME || '',
    AUTH_PASSWORD: window.APP_AUTH_PASSWORD || ''
};

const API = {
    async request(endpoint, options = {}) {
        const url = `${CONFIG.API_BASE_URL}/api${endpoint}`;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };
        
        // Add Basic Auth header if credentials are available
        // In production, these should be set in your deployment environment
        const authUsername = CONFIG.AUTH_USERNAME || '';
        const authPassword = CONFIG.AUTH_PASSWORD || '';
        
        if (authUsername && authPassword) {
            const credentials = btoa(`${authUsername}:${authPassword}`);
            headers['Authorization'] = `Basic ${credentials}`;
        }
        
        const config = {
            headers,
            ...options
        };

        try {
            const response = await fetch(url, config);
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || `HTTP ${response.status}`);
            }
            
            return data;
        } catch (error) {
            console.error(`API request failed: ${endpoint}`, error);
            throw error;
        }
    },

    agora: {
        getChannelInfo: (channel, uid) => 
            API.request(`/agora/channel-info?channel=${channel}&uid=${uid}`),
        
        startConversation: (data) => 
            API.request('/agora/start', {
                method: 'POST',
                body: JSON.stringify(data)
            }),
        
        stopConversation: (agentId) =>
            API.request(`/agora/stop/${agentId}`, {
                method: 'DELETE'
            })
    },

    healthcare: {
      getProfile: (id) =>
        API.request(`/healthcare/profiles/${id}`),
      listProfiles: (role) =>
        API.request(`/healthcare/profiles${role ? '?role=' + role : ''}`),
      listSummaries: () =>
        API.request('/healthcare/summaries'),
      createSummary: (data) =>
        API.request('/healthcare/summaries', { method: 'POST', body: JSON.stringify(data) }),
      getCarePlan: (patientId) =>
        API.request(`/healthcare/care-plans/${patientId}`),
      updateCarePlan: (id, data) =>
        API.request(`/healthcare/care-plans/${id}`, { method: 'PUT', body: JSON.stringify(data) })
    }
};

const STORAGE = {
    get: (key, defaultValue = null) => {
        try {
            const value = localStorage.getItem(key);
            return value ? JSON.parse(value) : defaultValue;
        } catch {
            return defaultValue;
        }
    },

    set: (key, value) => {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.warn('Failed to save to localStorage:', error);
        }
    },

    remove: (key) => {
        try {
            localStorage.removeItem(key);
        } catch (error) {
            console.warn('Failed to remove from localStorage:', error);
        }
    }
};

const UTILS = {
    generateChannelName: () => `channeName-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    
    formatTime: (date = new Date()) => {
        return date.toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
    },

    showToast: (message, type = 'info') => {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
};