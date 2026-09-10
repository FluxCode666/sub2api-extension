// Package sysutil provides system-level utilities for process management.
package sysutil

import (
	"log"
	"os"
	"runtime"
	"time"
)

// RestartService triggers a service restart by gracefully exiting.
//
// This relies on the process manager's restart policy to automatically
// restart the service after it exits:
//   - Docker: restart: unless-stopped / always in docker-compose.yml
//   - systemd: Restart=always in the unit file
//
// This is the industry-standard approach:
//   - Simple and reliable
//   - No sudo permissions needed
//   - No complex process management
//   - Leverages the process manager's native restart capability
//
// Prerequisites:
//   - The service must be configured with an automatic restart policy
//   - Linux (Docker or systemd)
func RestartService() error {
	if runtime.GOOS != "linux" {
		log.Println("Service restart via exit only works on Linux with a restart policy")
		return nil
	}

	log.Println("Initiating service restart by graceful exit...")
	log.Println("The process manager will automatically restart the service (restart policy)")

	// Give a moment for logs to flush and the response to be sent
	go func() {
		time.Sleep(100 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}

// RestartServiceAsync is a fire-and-forget version of RestartService.
// It logs errors instead of returning them, suitable for goroutine usage.
func RestartServiceAsync() {
	if err := RestartService(); err != nil {
		log.Printf("Service restart failed: %v", err)
		log.Println("Please restart the service manually")
	}
}
