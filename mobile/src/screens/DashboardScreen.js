import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Linking,
  Image,
} from 'react-native';
import { supabase, ADMIN_EMAILS } from '../lib/supabase';
import { colors, card, cardConnected } from '../theme';

const PLATFORMS = ['linkedin', 'instagram', 'tiktok', 'threads', 'youtube'];
const PLATFORM_NAMES = { tiktok: 'TikTok', instagram: 'Instagram', linkedin: 'LinkedIn', threads: 'Threads', youtube: 'YouTube' };
const PLATFORM_COLORS = {
  linkedin: '#0A66C2',
  instagram: '#E4405F',
  tiktok: '#000000',
  threads: '#000000',
  youtube: '#FF0000',
};

function formatFollowers(count) {
  if (!count) return null;
  if (count >= 1000000) return (count / 1000000).toFixed(1) + 'M';
  if (count >= 1000) return (count / 1000).toFixed(1) + 'K';
  return count.toString();
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function DashboardScreen({ navigation }) {
  const [accounts, setAccounts] = useState([]);
  const [posts, setPosts] = useState([]);
  const [user, setUser] = useState(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (!user) return;

    const [accountsRes, postsRes] = await Promise.all([
      supabase.from('connected_accounts').select('*').eq('user_id', user.id),
      supabase.from('posts').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(5),
    ]);

    if (accountsRes.data) setAccounts(accountsRes.data);
    if (postsRes.data) setPosts(postsRes.data);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  function connectPlatform(platform) {
    // Open the web OAuth flow in browser
    Linking.openURL(`https://lexaya.io/broadcast/connect.html?platform=${platform}`);
  }

  async function disconnectPlatform(platform) {
    Alert.alert(
      `Disconnect ${PLATFORM_NAMES[platform]}?`,
      'You can reconnect anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await supabase
              .from('connected_accounts')
              .delete()
              .eq('user_id', user.id)
              .eq('platform', platform);
            loadData();
          },
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>try lexaya</Text>
          <Text style={styles.tagline}>Post once, publish everywhere</Text>
        </View>
        <TouchableOpacity onPress={handleLogout}>
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Pro Member Badge */}
      <View style={styles.memberBadge}>
        <Text style={styles.memberLabel}>PRO MEMBER</Text>
        <View style={styles.memberStatus}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>Active</Text>
        </View>
      </View>

      {/* Connected Accounts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connected Accounts</Text>
        {PLATFORMS.map(platform => {
          const account = accounts.find(a => a.platform === platform);
          const isConnected = !!account;
          const metadata = account?.metadata || {};
          const username = account?.account_name || metadata.username || metadata.display_name;
          const followers = formatFollowers(metadata.followers_count || metadata.follower_count || metadata.subscribers_count);

          return (
            <TouchableOpacity
              key={platform}
              style={[styles.accountCard, isConnected && styles.accountCardConnected]}
              onPress={() => isConnected ? disconnectPlatform(platform) : connectPlatform(platform)}
            >
              <View style={[styles.platformIcon, { backgroundColor: PLATFORM_COLORS[platform] }]}>
                <Text style={styles.platformIconText}>
                  {platform[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.accountInfo}>
                <Text style={styles.accountName}>{PLATFORM_NAMES[platform]}</Text>
                {isConnected ? (
                  <Text style={styles.accountHandle}>@{username}{followers ? ` · ${followers}` : ''}</Text>
                ) : (
                  <Text style={styles.accountDisconnected}>Tap to connect</Text>
                )}
              </View>
              {isConnected && (
                <View style={styles.connectedDot} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => navigation.navigate('Upload')}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.primary }]}>
              <Text style={styles.actionIconText}>+</Text>
            </View>
            <Text style={styles.actionTitle}>New Post</Text>
            <Text style={styles.actionDesc}>Upload & publish everywhere</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => navigation.navigate('Scheduled')}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.yakWarm }]}>
              <Text style={styles.actionIconText}>⏰</Text>
            </View>
            <Text style={styles.actionTitle}>Scheduled</Text>
            <Text style={styles.actionDesc}>Manage scheduled posts</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => navigation.navigate('Calendar')}
          >
            <View style={[styles.actionIcon, { backgroundColor: colors.success }]}>
              <Text style={styles.actionIconText}>📅</Text>
            </View>
            <Text style={styles.actionTitle}>Calendar</Text>
            <Text style={styles.actionDesc}>Posting consistency</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Recent Posts */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Posts</Text>
        {posts.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No posts yet</Text>
            <Text style={styles.emptyDesc}>Create your first post to get started!</Text>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => navigation.navigate('Upload')}
            >
              <Text style={styles.emptyButtonText}>Create Post</Text>
            </TouchableOpacity>
          </View>
        ) : (
          posts.map(post => (
            <View key={post.id} style={styles.postItem}>
              <View style={styles.postThumbnail}>
                {post.thumbnail_url ? (
                  <Image source={{ uri: post.thumbnail_url }} style={styles.postImage} />
                ) : (
                  <Text style={styles.postPlaceholder}>{post.video_url ? '🎬' : '📝'}</Text>
                )}
              </View>
              <View style={styles.postInfo}>
                <Text style={styles.postCaption} numberOfLines={2}>{post.caption || 'No caption'}</Text>
                <Text style={styles.postDate}>{formatDate(post.created_at)}</Text>
              </View>
              <View style={[styles.postStatusBadge, post.status === 'published' && styles.statusPublished, post.status === 'scheduled' && styles.statusScheduled]}>
                <Text style={styles.postStatusText}>{post.status}</Text>
              </View>
            </View>
          ))
        )}
      </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 2,
    borderBottomColor: colors.yakPink,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  tagline: {
    fontSize: 13,
    color: colors.textLight,
    marginTop: 2,
  },
  logoutText: {
    color: colors.textLight,
    fontSize: 13,
  },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    marginBottom: 24,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  memberLabel: {
    color: colors.white,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 1,
  },
  memberStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4ade80',
  },
  statusText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 12,
  },
  accountCard: {
    ...card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  accountCardConnected: {
    borderColor: colors.success,
  },
  platformIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformIconText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  accountInfo: {
    flex: 1,
  },
  accountName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  accountHandle: {
    fontSize: 13,
    color: colors.textLight,
    marginTop: 2,
  },
  accountDisconnected: {
    fontSize: 13,
    color: colors.primary,
    marginTop: 2,
  },
  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  actionsGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  actionCard: {
    flex: 1,
    ...card,
    alignItems: 'center',
    paddingVertical: 16,
  },
  actionIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionIconText: {
    fontSize: 20,
    color: colors.white,
    fontWeight: '700',
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.text,
    marginBottom: 2,
  },
  actionDesc: {
    fontSize: 11,
    color: colors.textLight,
    textAlign: 'center',
  },
  emptyState: {
    ...card,
    alignItems: 'center',
    padding: 30,
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
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: colors.white,
    fontWeight: '600',
    fontSize: 14,
  },
  postItem: {
    ...card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  postThumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: colors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postImage: {
    width: '100%',
    height: '100%',
  },
  postPlaceholder: {
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
  postStatusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.border,
  },
  statusPublished: {
    backgroundColor: '#dcfce7',
  },
  statusScheduled: {
    backgroundColor: '#fef3c7',
  },
  postStatusText: {
    fontSize: 11,
    fontWeight: '500',
    color: colors.text,
    textTransform: 'capitalize',
  },
});
