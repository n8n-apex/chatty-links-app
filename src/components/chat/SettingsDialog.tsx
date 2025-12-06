import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Link2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  webhookUrl: string;
  onSaveWebhookUrl: (url: string) => void;
}

export const SettingsDialog = ({
  isOpen,
  onClose,
  webhookUrl,
  onSaveWebhookUrl,
}: SettingsDialogProps) => {
  const [url, setUrl] = useState(webhookUrl);

  const handleSave = () => {
    onSaveWebhookUrl(url);
    toast.success('Webhook URL saved successfully');
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.3 }}
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2"
          >
            <div className="glass rounded-2xl p-6 shadow-soft">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-foreground">Settings</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="rounded-xl"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                    <Link2 className="h-4 w-4 text-primary" />
                    n8n Webhook URL
                  </label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://your-n8n-instance.com/webhook/..."
                    className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Enter your n8n webhook URL to connect the chat interface
                  </p>
                </div>

                <Button
                  variant="glow"
                  onClick={handleSave}
                  className="w-full"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Save Settings
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};
