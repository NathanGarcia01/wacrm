'use client';

import { useTranslations } from 'next-intl';
import { BadgeCheck, QrCode } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface WhatsAppChannelTypePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCloudApi: () => void;
  onSelectEvolution: () => void;
}

/**
 * First step of "Adicionar número" — the two connection methods the
 * account can choose between. Selecting a card closes this dialog and
 * opens the matching next step (WhatsAppChannelFormDialog for Cloud
 * API, EvolutionChannelDialog for QR Code).
 */
export function WhatsAppChannelTypePicker({
  open,
  onOpenChange,
  onSelectCloudApi,
  onSelectEvolution,
}: WhatsAppChannelTypePickerProps) {
  const t = useTranslations('settings.whatsapp.channels');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">{t('typePickerTitle')}</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('typePickerDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 py-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onSelectCloudApi}
            className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-left transition-colors hover:border-primary hover:bg-muted/50"
          >
            <div className="flex w-full items-center justify-between">
              <BadgeCheck className="size-6 text-primary" />
              <Badge className="bg-primary/10 text-primary border-primary/30">
                {t('cloudApiCardBadge')}
              </Badge>
            </div>
            <div>
              <p className="font-medium text-foreground">{t('cloudApiCardTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('cloudApiCardDescription')}</p>
            </div>
          </button>

          <button
            type="button"
            onClick={onSelectEvolution}
            className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 text-left transition-colors hover:border-primary hover:bg-muted/50"
          >
            <div className="flex w-full items-center justify-between">
              <QrCode className="size-6 text-primary" />
              <Badge variant="secondary">{t('evolutionCardBadge')}</Badge>
            </div>
            <div>
              <p className="font-medium text-foreground">{t('evolutionCardTitle')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('evolutionCardDescription')}</p>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
