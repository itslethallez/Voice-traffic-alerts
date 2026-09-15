import { useCallback, useEffect, useState } from 'react';
import { facebookNotificationIntake } from './facebookNotificationIntake';
import { sortFacebookNotification } from './sortFacebookNotification';
import { useCommunityReportStore } from '../store/useCommunityReportStore';
import type { NotificationAccessStatus } from './facebookNotificationIntake.types';

export type FacebookNotificationSourceControls = {
  accessStatus: NotificationAccessStatus;
  pendingCount: number;
  openAccessSettings: () => Promise<boolean>;
  refreshAccessStatus: () => Promise<void>;
};

/**
 * Owns the Android-only listener lifecycle at app level. The listener crosses
 * the bridge only after native package filtering; the sorter then drops raw
 * title/body text and stores normalized candidates for review.
 */
export function useFacebookNotificationSource(): FacebookNotificationSourceControls {
  const [accessStatus, setAccessStatus] = useState<NotificationAccessStatus>('unsupported');
  const addCandidate = useCommunityReportStore((state) => state.addCandidate);
  const pendingCount = useCommunityReportStore((state) => state.candidates.length);

  const refreshAccessStatus = useCallback(async () => {
    try {
      const status = await facebookNotificationIntake.getNotificationAccessStatus();
      setAccessStatus(status);
    } catch {
      setAccessStatus('unsupported');
    }
  }, []);

  useEffect(() => {
    void refreshAccessStatus();
    const subscription = facebookNotificationIntake.addListener((event) => {
      const candidate = sortFacebookNotification(event);
      if (candidate) addCandidate(candidate);
    });
    return () => subscription.remove();
  }, [addCandidate, refreshAccessStatus]);

  const openAccessSettings = useCallback(async () => {
    const opened = await facebookNotificationIntake.openNotificationAccessSettings();
    await refreshAccessStatus();
    return opened;
  }, [refreshAccessStatus]);

  return { accessStatus, pendingCount, openAccessSettings, refreshAccessStatus };
}
