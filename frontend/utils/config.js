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
                const msg = data.details
                    ? `${data.error}: ${data.details}`
                    : (data.error || `HTTP ${response.status}`);
                throw new Error(msg);
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
        
        startSIPCall: (data) =>
            API.request('/agora/call', {
                method: 'POST',
                body: JSON.stringify(data)
            }),

        stopConversation: (agentId) =>
            API.request(`/agora/stop/${agentId}`, {
                method: 'DELETE'
            }),

        getAgentStatus: (agentId) =>
            API.request(`/agora/status/${agentId}`)
    },

    healthcare: {
      getProfile: (id) =>
        API.request(`/healthcare/profiles/${id}`),
      listProfiles: (role) =>
        API.request(`/healthcare/profiles${role ? '?role=' + role : ''}`),
      listSummaries: (arg) => {
        let patient_id;
        let doctor_id;
        if (typeof arg === 'string') {
          patient_id = arg;
        } else if (arg && typeof arg === 'object') {
          patient_id = arg.patient_id;
          doctor_id = arg.doctor_id;
        }
        const params = new URLSearchParams();
        if (patient_id) params.set('patient_id', patient_id);
        if (doctor_id) params.set('doctor_id', doctor_id);
        const qs = params.toString();
        return API.request(`/healthcare/summaries${qs ? '?' + qs : ''}`);
      },
      createSummary: (data) =>
        API.request('/healthcare/summaries', { method: 'POST', body: JSON.stringify(data) }),
      summarize: (data) =>
        API.request('/healthcare/summarize', { method: 'POST', body: JSON.stringify(data) }),
      getProfileSummary: (patientId) =>
        API.request(`/healthcare/profile-summary/${patientId}`),
      listAppointments: (params) =>
        API.request(`/healthcare/appointments${params ? '?' + new URLSearchParams(params) : ''}`),
      getAvailability: ({ doctor_id, date }) =>
        API.request(`/healthcare/availability?doctor_id=${encodeURIComponent(doctor_id)}&date=${encodeURIComponent(date)}`),
      createAppointment: (data) =>
        API.request('/healthcare/appointments', { method: 'POST', body: JSON.stringify(data) }),
      updateAppointment: (id, data) =>
        API.request(`/healthcare/appointments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
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

    /** Human-readable consultation category for call history (from LLM / DB). */
    consultationKindLabel(kind, callType) {
        const map = {
            general_consulting: 'General consulting',
            post_op_call: 'Post-op call',
            appointment_booking: 'Appointment booking',
            condition_followup: 'Condition follow-up',
            doctor_assistant: 'Doctor assistant session',
            other: 'Other'
        };
        if (kind && map[kind]) return map[kind];
        if (callType === 'post-op') return 'Post-op call';
        if (callType === 'doctor-query') return 'Doctor assistant session';
        if (callType === 'patient') return 'General consulting';
        return callType ? String(callType).replace(/-/g, ' ') : 'Call';
    },

    formatTime: (date = new Date()) => {
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    /**
     * Format a naive wall-clock appointment time WITHOUT timezone conversion.
     * Input: "YYYY-MM-DDTHH:MM[:SS][Z]" -> "Jun 16, 2026 · 2:00 PM".
     * Reads the wall-clock digits directly so every viewer sees the same label.
     */
    formatApptTime: (dt) => {
        if (typeof dt !== 'string') return '';
        const m = dt.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
        if (!m) return dt;
        const [, y, mo, d, hh, mm] = m;
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let h = Number(hh);
        const ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12; if (h === 0) h = 12;
        return `${months[Number(mo) - 1]} ${Number(d)}, ${y} · ${h}:${mm} ${ampm}`;
    },

    showToast: (message, type = 'info') => {
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
};