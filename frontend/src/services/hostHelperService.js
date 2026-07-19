import axios from 'axios';

/**
 * Client for the AIDA host helper (tools/helper.py).
 * The helper is a small local HTTP service running on the host (not Docker)
 * that performs actions the browser cannot: opening folders in the file
 * explorer and launching aida.py in a new terminal window.
 */
const HELPER_URL = 'http://localhost:9876';

/**
 * Open a folder in the host's file explorer (Finder, Explorer, xdg-open).
 * The helper restricts paths to AIDA workspaces only.
 *
 * @param {string} path - Absolute path under the AIDA workspace tree
 * @returns {Promise<{success: boolean}>}
 */
export const openFolderOnHost = async (path) => {
    try {
        const response = await axios.post(`${HELPER_URL}/open`, { path }, {
            timeout: 3000,
        });
        return response.data;
    } catch (error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ERR_NETWORK') {
            throw new Error('Host helper not running. Start it with: python3 tools/helper.py');
        }
        throw error;
    }
};

/**
 * Check if the host helper is reachable.
 * @returns {Promise<boolean>}
 */
export const isHostHelperAvailable = async () => {
    try {
        await axios.get(`${HELPER_URL}/status`, { timeout: 1000 });
        return true;
    } catch {
        return false;
    }
};

/**
 * Launch aida.py for an assessment in a new terminal window on the host.
 * Throws if the helper is unreachable or returns a non-2xx status.
 *
 * @param {string} assessmentName
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export const launchAidaOnHost = async (assessmentName) => {
    const response = await axios.post(
        `${HELPER_URL}/launch`,
        { assessment_name: assessmentName },
        { timeout: 5000 },
    );
    return response.data;
};

// Backward-compat alias — old code still imports under the previous name
export const isFolderOpenerAvailable = isHostHelperAvailable;

export default {
    openFolderOnHost,
    isHostHelperAvailable,
    launchAidaOnHost,
};
