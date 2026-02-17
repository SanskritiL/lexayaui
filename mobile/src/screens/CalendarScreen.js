import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, card } from '../theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarScreen() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [postDates, setPostDates] = useState({});

  useEffect(() => {
    loadPosts();
  }, [currentDate]);

  async function loadPosts() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const startDate = new Date(year, month, 1).toISOString();
    const endDate = new Date(year, month + 1, 0, 23, 59, 59).toISOString();

    const { data } = await supabase
      .from('posts')
      .select('created_at, status')
      .eq('user_id', user.id)
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    if (data) {
      const dates = {};
      data.forEach(post => {
        const day = new Date(post.created_at).getDate();
        dates[day] = post.status;
      });
      setPostDates(dates);
    }
  }

  function getDaysInMonth() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayOfWeek = new Date(year, month, 1).getDay();
    return { daysInMonth, firstDayOfWeek };
  }

  function prevMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  }

  const { daysInMonth, firstDayOfWeek } = getDaysInMonth();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear();
  const monthName = currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const cells = [];
  for (let i = 0; i < firstDayOfWeek; i++) {
    cells.push(null);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(d);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.pageTitle}>Posting Calendar</Text>
      <Text style={styles.pageSubtitle}>Track your posting consistency</Text>

      <View style={styles.calendarCard}>
        {/* Month Nav */}
        <View style={styles.monthNav}>
          <TouchableOpacity onPress={prevMonth} style={styles.navButton}>
            <Text style={styles.navButtonText}>{'<'}</Text>
          </TouchableOpacity>
          <Text style={styles.monthTitle}>{monthName}</Text>
          <TouchableOpacity onPress={nextMonth} style={styles.navButton}>
            <Text style={styles.navButtonText}>{'>'}</Text>
          </TouchableOpacity>
        </View>

        {/* Day Headers */}
        <View style={styles.daysRow}>
          {DAYS.map(day => (
            <Text key={day} style={styles.dayHeader}>{day}</Text>
          ))}
        </View>

        {/* Calendar Grid */}
        <View style={styles.calendarGrid}>
          {cells.map((day, index) => {
            const isToday = isCurrentMonth && day === today.getDate();
            const hasPost = day && postDates[day];

            return (
              <View
                key={index}
                style={[
                  styles.calendarDay,
                  !day && styles.emptyDay,
                  isToday && styles.todayDay,
                  hasPost && styles.postedDay,
                ]}
              >
                {day && (
                  <>
                    <Text style={[styles.dayNumber, isToday && styles.todayText]}>{day}</Text>
                    {hasPost && <Text style={styles.postEmoji}>✅</Text>}
                  </>
                )}
              </View>
            );
          })}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={styles.legendToday} />
            <Text style={styles.legendText}>Today</Text>
          </View>
          <View style={styles.legendItem}>
            <Text style={styles.legendEmoji}>✅</Text>
            <Text style={styles.legendText}>Posted</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 20,
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
  calendarCard: {
    ...card,
    padding: 16,
  },
  monthNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  navButton: {
    width: 36,
    height: 36,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  monthTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  daysRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  dayHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.textLight,
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDay: {
    width: '14.28%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: '#f8fafc',
    marginBottom: 4,
  },
  emptyDay: {
    backgroundColor: 'transparent',
  },
  todayDay: {
    borderColor: colors.primary,
    backgroundColor: '#fef0f0',
  },
  postedDay: {
    backgroundColor: 'transparent',
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text,
  },
  todayText: {
    color: colors.primary,
    fontWeight: '700',
  },
  postEmoji: {
    fontSize: 10,
    marginTop: 1,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: colors.border,
    borderStyle: 'dashed',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendToday: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#fef0f0',
  },
  legendEmoji: {
    fontSize: 14,
  },
  legendText: {
    fontSize: 12,
    color: colors.textLight,
  },
});
