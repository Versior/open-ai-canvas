// Command plugin-bootstrap exercises the production package bootstrap on an offline data clone.
// It neither opens the application database nor starts workers or a listener.
package main

import (
	"log"
	"os"

	"yingce/backend/internal/app"
)

func main() {
	if len(os.Args) != 2 || os.Getenv("CANVAS_OFFICIAL_PLUGIN_DIR") == "" {
		log.Fatal("usage: CANVAS_OFFICIAL_PLUGIN_DIR=<release packages> plugin-bootstrap <offline data clone>")
	}
	if err := app.BootstrapOfflinePlugins(os.Args[1]); err != nil {
		log.Fatal(err)
	}
}
