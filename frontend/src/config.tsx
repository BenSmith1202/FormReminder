// Single source of truth for the backend URL.
// In production, VITE_API_URL is injected at build time by the deploy script.
// In local dev, it falls back to localhost:5000 automatically.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export default API_URL;
