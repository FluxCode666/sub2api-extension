// updater 独立于应用运行。仅通过共享卷中的 Unix socket 接受管理员请求。
package main

import (
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/sys/unix"
	"sub2api-extension/internal/update"
)

func main() {
	const stateDir = "/run/sub2api-update"
	if err := os.MkdirAll(stateDir, 0750); err != nil {
		log.Fatal(err)
	}
	if err := os.Chown(stateDir, 0, 1000); err != nil {
		log.Fatal(err)
	}
	if err := os.Chmod(stateDir, 0750); err != nil {
		log.Fatal(err)
	}
	lock, err := os.OpenFile(filepath.Join(stateDir, "updater.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		log.Fatal(err)
	}
	defer func() { _ = lock.Close() }()
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		log.Fatal("已有更新服务持有此数据卷")
	}
	engine := &update.DockerEngine{Directory: os.Getenv("SUB2API_EXTENSION_DEPLOY_PATH"), Project: os.Getenv("SUB2API_EXTENSION_COMPOSE_PROJECT"), StateDir: stateDir, Command: update.DockerCommand}
	if err := engine.Validate(); err != nil {
		log.Fatal(err)
	}
	manager, err := update.NewManager(update.NewGitHubFromEnv(), engine, filepath.Join(stateDir, "job.json"))
	if err != nil {
		log.Fatal(err)
	}
	socket := filepath.Join(stateDir, "updater.sock")
	if err := os.Remove(socket); err != nil && !os.IsNotExist(err) {
		log.Fatal(err)
	}
	listener, err := net.Listen("unix", socket)
	if err != nil {
		log.Fatal(err)
	}
	if err := os.Chown(socket, 0, 1000); err != nil {
		log.Fatal(err)
	}
	if err := os.Chmod(socket, 0660); err != nil {
		log.Fatal(err)
	}
	server := &http.Server{Handler: manager.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 60 * time.Second}
	log.Println("更新服务已启动，等待管理员发起更新")
	log.Fatal(server.Serve(listener))
}
