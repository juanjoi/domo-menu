// Package script embeds the menu script served by the service.
package script

import _ "embed"

// JS is the menu script.
//
//go:embed menu.js
var JS []byte
