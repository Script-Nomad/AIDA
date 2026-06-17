// OWASP ASVS verdict status utilities (mirror of utils/severity.js)

export const ASVS_STATUSES = ['NOT_TESTED', 'PASS', 'FAIL', 'NA'];

export const ASVS_STATUS_LABEL = {
  NOT_TESTED: 'Not tested',
  PASS: 'Pass',
  FAIL: 'Fail',
  NA: 'N/A',
};

/** Full badge classes: text + background + border */
export const getAsvsStatusBadgeClass = (status) => {
  switch (status) {
    case 'PASS': return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700';
    case 'FAIL': return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-700';
    case 'NA':   return 'text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700';
    default:     return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700'; // NOT_TESTED
  }
};

/** Left border strip color — used on rows */
export const getAsvsStatusStripClass = (status) => {
  switch (status) {
    case 'PASS': return 'border-l-green-500';
    case 'FAIL': return 'border-l-red-500';
    case 'NA':   return 'border-l-neutral-300 dark:border-l-neutral-600';
    default:     return 'border-l-amber-400'; // NOT_TESTED
  }
};

/** Solid bar/dot color — used in coverage bar + dots */
export const getAsvsStatusBarClass = (status) => {
  switch (status) {
    case 'PASS': return 'bg-green-500';
    case 'FAIL': return 'bg-red-500';
    case 'NA':   return 'bg-neutral-400';
    default:     return 'bg-amber-400'; // NOT_TESTED
  }
};
