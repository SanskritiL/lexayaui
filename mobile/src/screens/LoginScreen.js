import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { colors, card } from '../theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('email'); // 'email' or 'otp'

  async function handleSendOtp() {
    if (!email.trim()) {
      Alert.alert('Oops', 'Please enter your email');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setStep('otp');
    }
  }

  async function handleVerifyOtp() {
    if (!otp.trim()) {
      Alert.alert('Oops', 'Please enter the code from your email');
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: otp.trim(),
      type: 'email',
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
    }
    // If successful, onAuthStateChange in AppNavigator handles navigation
  }

  if (step === 'otp') {
    return (
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent an 8-digit code to {email}
          </Text>
          <TextInput
            style={styles.otpInput}
            placeholder="00000000"
            placeholderTextColor={colors.yakWarm}
            value={otp}
            onChangeText={setOtp}
            keyboardType="number-pad"
            maxLength={8}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleVerifyOtp}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Verifying...' : 'Verify Code'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => { setStep('email'); setOtp(''); }}
          >
            <Text style={styles.secondaryButtonText}>Use a different email</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.card}>
        <Text style={styles.title}>try lexaya</Text>
        <Text style={styles.tagline}>Post once, publish everywhere</Text>
        <Text style={styles.subtitle}>
          Enter your email and we'll send you a login code.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="you@email.com"
          placeholderTextColor={colors.yakWarm}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSendOtp}
          disabled={loading}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Sending...' : 'Send Code'}
          </Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    ...card,
    alignItems: 'center',
    padding: 30,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  tagline: {
    fontSize: 15,
    color: colors.textLight,
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textLight,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  input: {
    width: '100%',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginBottom: 16,
  },
  otpInput: {
    width: '100%',
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 16,
    textAlign: 'center',
    letterSpacing: 6,
  },
  button: {
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 20,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
