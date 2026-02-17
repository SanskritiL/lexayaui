import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { colors, card } from '../theme';

const PLATFORM_NAMES = { tiktok: 'TikTok', instagram: 'Instagram', linkedin: 'LinkedIn', threads: 'Threads', youtube: 'YouTube' };
const PLATFORM_COLORS = {
  linkedin: '#0A66C2',
  instagram: '#E4405F',
  tiktok: '#000000',
  threads: '#000000',
  youtube: '#FF0000',
};

export default function UploadScreen({ navigation }) {
  const [caption, setCaption] = useState('');
  const [mediaUri, setMediaUri] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [connectedAccounts, setConnectedAccounts] = useState([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState([]);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    loadAccounts();
  }, []);

  async function loadAccounts() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('connected_accounts')
      .select('*')
      .eq('user_id', user.id);

    if (data) {
      setConnectedAccounts(data);
      setSelectedPlatforms(data.map(a => a.platform));
    }
  }

  async function pickMedia() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please grant access to your media library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsEditing: true,
      quality: 0.8,
    });

    if (!result.canceled) {
      setMediaUri(result.assets[0].uri);
      setMediaType(result.assets[0].type || 'video');
    }
  }

  function togglePlatform(platform) {
    setSelectedPlatforms(prev =>
      prev.includes(platform)
        ? prev.filter(p => p !== platform)
        : [...prev, platform]
    );
  }

  async function handlePublish() {
    if (!mediaUri) {
      Alert.alert('No media', 'Please select a video or image to post.');
      return;
    }
    if (selectedPlatforms.length === 0) {
      Alert.alert('No platforms', 'Select at least one platform to publish to.');
      return;
    }

    setPublishing(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();

      // Upload media to R2 via API
      const formData = new FormData();
      formData.append('file', {
        uri: mediaUri,
        type: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
        name: mediaType === 'video' ? 'upload.mp4' : 'upload.jpg',
      });
      formData.append('caption', caption);
      formData.append('platforms', JSON.stringify(selectedPlatforms));

      const response = await fetch('https://lexaya.io/api/broadcast/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        Alert.alert('Published!', `Posted to ${selectedPlatforms.length} platform(s)`, [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } else {
        Alert.alert('Error', data.error || 'Failed to publish');
      }
    } catch (error) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setPublishing(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>New Post</Text>
      <Text style={styles.pageSubtitle}>Upload and publish to multiple platforms</Text>

      {/* Media Upload */}
      <TouchableOpacity style={styles.uploadZone} onPress={pickMedia}>
        {mediaUri ? (
          <Image source={{ uri: mediaUri }} style={styles.previewImage} />
        ) : (
          <>
            <Text style={styles.uploadIcon}>📤</Text>
            <Text style={styles.uploadTitle}>Tap to select media</Text>
            <Text style={styles.uploadDesc}>Video or image from your library</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Caption */}
      <View style={styles.formGroup}>
        <Text style={styles.label}>Caption</Text>
        <TextInput
          style={styles.textArea}
          placeholder="Write your caption..."
          placeholderTextColor={colors.textLight}
          value={caption}
          onChangeText={setCaption}
          multiline
          numberOfLines={4}
          textAlignVertical="top"
        />
      </View>

      {/* Platform Selection */}
      <View style={styles.formGroup}>
        <Text style={styles.label}>Publish to</Text>
        <View style={styles.platformsGrid}>
          {connectedAccounts.map(account => (
            <TouchableOpacity
              key={account.platform}
              style={[
                styles.platformChip,
                selectedPlatforms.includes(account.platform) && styles.platformChipSelected,
              ]}
              onPress={() => togglePlatform(account.platform)}
            >
              <View style={[styles.platformDot, { backgroundColor: PLATFORM_COLORS[account.platform] }]} />
              <Text style={[
                styles.platformChipText,
                selectedPlatforms.includes(account.platform) && styles.platformChipTextSelected,
              ]}>
                {PLATFORM_NAMES[account.platform]}
              </Text>
            </TouchableOpacity>
          ))}
          {connectedAccounts.length === 0 && (
            <Text style={styles.noPlatforms}>No accounts connected. Connect platforms from the dashboard.</Text>
          )}
        </View>
      </View>

      {/* Publish Button */}
      <TouchableOpacity
        style={[styles.publishButton, publishing && styles.publishButtonDisabled]}
        onPress={handlePublish}
        disabled={publishing}
      >
        {publishing ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.publishButtonText}>
            Publish to {selectedPlatforms.length} Platform{selectedPlatforms.length !== 1 ? 's' : ''}
          </Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  pageSubtitle: {
    fontSize: 14,
    color: colors.textLight,
    marginBottom: 24,
  },
  uploadZone: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    minHeight: 200,
    overflow: 'hidden',
  },
  uploadIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  uploadDesc: {
    fontSize: 13,
    color: colors.textLight,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 8,
  },
  textArea: {
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    color: colors.text,
    minHeight: 100,
  },
  platformsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  platformChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
  },
  platformChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.bgCard,
  },
  platformDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  platformChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  platformChipTextSelected: {
    color: colors.primary,
  },
  noPlatforms: {
    fontSize: 13,
    color: colors.textLight,
    fontStyle: 'italic',
  },
  publishButton: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  publishButtonDisabled: {
    opacity: 0.6,
  },
  publishButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
});
