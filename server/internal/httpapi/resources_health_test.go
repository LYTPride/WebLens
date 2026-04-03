package httpapi

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestComputePodHealth_BasicScenarios(t *testing.T) {
	now := time.Now()

	cases := []struct {
		name     string
		pod      corev1.Pod
		expected string
	}{
		{
			name: "Running all ready no restarts",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						{Ready: true},
						{Ready: true},
					},
				},
			},
			expected: "健康",
		},
		{
			name: "Running partial ready",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodRunning,
					ContainerStatuses: []corev1.ContainerStatus{
						{Ready: true},
						{Ready: false},
					},
				},
			},
			expected: "关注",
		},
		{
			name: "CrashLoopBackOff",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase:  corev1.PodRunning,
					Reason: "CrashLoopBackOff",
				},
			},
			expected: "严重",
		},
		{
			name: "ImagePullBackOff",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase:  corev1.PodPending,
					Reason: "ImagePullBackOff",
				},
			},
			expected: "严重",
		},
		{
			name: "Pending long time",
			pod: corev1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					CreationTimestamp: metav1.NewTime(now.Add(-11 * time.Minute)),
				},
				Status: corev1.PodStatus{
					Phase: corev1.PodPending,
				},
			},
			// Pending(20) + >10min(30) = 50, 落在警告区间
			expected: "警告",
		},
		{
			name: "Completed no restarts",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodSucceeded,
				},
			},
			expected: "健康",
		},
		{
			name: "Completed with many restarts",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodSucceeded,
					ContainerStatuses: []corev1.ContainerStatus{
						{RestartCount: 120},
					},
				},
			},
			// Restart 很高会被扣分，因此不应是“健康”，这里至少应为“警告”或“严重”
			expected: "警告",
		},
		{
			name: "Unknown phase",
			pod: corev1.Pod{
				Status: corev1.PodStatus{
					Phase: corev1.PodUnknown,
				},
			},
			expected: "严重",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			h := computePodHealth(&tc.pod, now)
			if h.HealthLabel != tc.expected {
				t.Fatalf("expected label %q, got %q (score=%d, reasons=%v)", tc.expected, h.HealthLabel, h.HealthScore, h.HealthReasons)
			}
		})
	}
}

