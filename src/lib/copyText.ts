import { toast } from 'sonner';

/**
 * Clipboard helper shared by every copyable citation surface.
 * Refuses non-strings (backend has shipped objects into text fields before) so
 * "[object Object]" can never reach a document sent to an authority.
 */
export const copyPlainText = async (
  value: unknown,
  successMessage = 'Kopiert',
): Promise<boolean> => {
  if (typeof value !== 'string' || !value.trim()) {
    toast.error('Konnte nicht kopiert werden (unerwartetes Format). Bitte den Text manuell markieren.');
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    toast.success(successMessage);
    return true;
  } catch (e) {
    toast.error('Kopieren fehlgeschlagen. Bitte den Text manuell markieren und kopieren.');
    console.error('[copyPlainText] clipboard write failed', e);
    return false;
  }
};

export const UNVERIFIED_SUFFIX = ' — nicht in den abgerufenen Quellen belegt';
