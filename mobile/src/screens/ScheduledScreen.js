import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, card } from '../theme';

const PLATFORM_NAMES = { tiktok: 'TikTok', instagram: 'Instagram', linkedin: 'LinkedIn', threads: 'Threads', youtube: 'YouTube' };

export default function ScheduledScreen() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScheduledPosts();
  }, []);

  async function loadScheduledPosts() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('posts')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true });

    if (data) setPosts(data);
    setLoading(false);
  }

  async function cancelPost(postId) {
    Alert.alert('Cancel Post?', 'This scheduled post will be removed.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Cancel Post',
        style: 'destructive',
        onPress: async () => {
          await supabase.from('posts').delete().eq('id', postId);
          setPosts(prev => prev.filter(p => p.id !== postId));
        },
      },
    ]);
  }

  function formatScheduledDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Scheduled Posts</Text>
      <Text style={styles.pageSubtitle}>Manage your upcoming posts</Text>

      {loading ? (
        <Text style={styles.loadingText}>Loading...</Text>
      ) : posts.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📭</Text>
          <Text style={styles.emptyTitle}>No scheduled posts</Text>
          <Text style={styles.emptyDesc}>Schedule posts from the upload screen</Text>
        </View>
      ) : (
        posts.map(post => (
          <View key={post.id} style={styles.postCard}>
            <View style={styles.postHeader}>
              {post.thumbnail_url ? (
                <Image source={{ uri: post.thumbnail_url }} style={styles.thumbnail} />
              ) : (
                <View style={styles.thumbnailPlaceholder}>
                  <Text style={styles.thumbnailIcon}>{post.video_url ? '🎬' : '📝'}</Text>
                </View>
              )}
              <View style={styles.postInfo}>
                <Text style={styles.postCaption} numberOfLines={2}>
                  {post.caption || 'No caption'}
                </Text>
                <Text style={styles.postDate}>
                  {post.scheduled_at ? formatScheduledDate(post.scheduled_at) : 'No date set'}
                </Text>
              </View>
            </View>

            <View style={styles.postFooter}>
              <View style={styles.platformTags}>
                {(post.platforms || []).map(p => (
                  <View key={p} style={styles.platformTag}>
                    <Text style={styles.platformTagText}>{PLATFORM_NAMES[p] || p}</Text>
                  </View>
                ))}
              </View>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => cancelPost(post.id)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
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
  loadingText: {
    textAlign: 'center',
    color: colors.textLight,
    padding: 40,
  },
  emptyState: {
    ...card,
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 4,
  },
  emptyDesc: {
    fontSize: 14,
    color: colors.textLight,
  },
  postCard: {
    ...card,
    marginBottom: 12,
  },
  postHeader: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  thumbnailPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbnailIcon: {
    fontSize: 24,
  },
  postInfo: {
    flex: 1,
  },
  postCaption: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
    marginBottom: 4,
  },
  postDate: {
    fontSize: 12,
    color: colors.textLight,
  },
  postFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  platformTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  platformTag: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  platformTagText: {
    fontSize: 11,
    color: colors.text,
    fontWeight: '500',
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fee2e2',
  },
  cancelButtonText: {
    fontSize: 12,
    color: '#dc2626',
    fontWeight: '500',
  },
});
