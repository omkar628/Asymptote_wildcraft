import AsyncStorage from '@react-native-async-storage/async-storage';

export async function readStoredValue(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writeStoredValue(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

export async function removeStoredValue(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}
