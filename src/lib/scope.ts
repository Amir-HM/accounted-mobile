import { ApiError } from './api';
import { clearConnection } from './connection';
import { tr } from './i18n';
import { queryClient } from './queries';
import { showToast } from './toast';

/** Errors from write actions as one toast; a missing permission offers to sign in again. `what` is already translated. */
export function reportActionError(e: unknown, what: string) {
  if (e instanceof ApiError && e.code === 'INSUFFICIENT_SCOPE') {
    showToast(tr('{what} needs new permissions for this iPhone.', { what }), 'error', {
      label: tr('Sign in again'),
      onPress: async () => {
        queryClient.clear();
        await clearConnection();
      },
    });
    return;
  }
  showToast(e instanceof Error ? e.message : String(e), 'error');
}
