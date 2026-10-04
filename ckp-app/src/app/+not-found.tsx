import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { EmptyState, Screen } from '@/components/ui';

export default function NotFoundScreen() {
  return (
    <Screen safeBottom>
      <View style={styles.center}>
        <EmptyState
          icon="compass-outline"
          title="페이지를 찾을 수 없습니다"
          description="주소가 바뀌었거나 삭제된 화면입니다. 첫 화면으로 이동해 주세요."
          actionLabel="첫 화면으로"
          actionIcon="home-outline"
          onAction={() => router.replace('/')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
  },
});
