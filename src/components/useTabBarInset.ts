import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { tabContentInset } from '@/theme';

export function useTabBarInset(): number {
  const insets = useSafeAreaInsets();
  return tabContentInset(insets.bottom);
}
