// Package position keeps the single menu button position of the house.
package position

import (
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
)

// Default is the position before anyone moves the button.
const Default = "right:0.500"

var formatRe = regexp.MustCompile(`^(top|right|bottom|left):([01](\.\d{1,3})?)$`)

// ErrInvalid is returned for values that are not "edge:offset".
var ErrInvalid = errors.New("posición no válida")

// Normalize validates a position such as "left:0.25" and returns it with
// three decimals.
func Normalize(value string) (string, error) {
	m := formatRe.FindStringSubmatch(strings.TrimSpace(value))
	if m == nil {
		return "", ErrInvalid
	}
	offset, err := strconv.ParseFloat(m[2], 64)
	if err != nil || offset < 0 || offset > 1 {
		return "", ErrInvalid
	}
	return m[1] + ":" + strconv.FormatFloat(offset, 'f', 3, 64), nil
}

// Store keeps the position in memory and, if File is set, on disk.
type Store struct {
	File string

	mu    sync.Mutex
	value string
}

// Load reads the saved position. A missing or invalid file leaves the default.
func (s *Store) Load() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.value = Default
	if s.File == "" {
		return
	}
	b, err := os.ReadFile(s.File)
	if err != nil {
		return
	}
	if v, err := Normalize(string(b)); err == nil {
		s.value = v
	}
}

// Get returns the current position.
func (s *Store) Get() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.value == "" {
		return Default
	}
	return s.value
}

// Set validates and saves a position. It is kept in memory even if it
// cannot be written to disk, and the error is returned.
func (s *Store) Set(value string) error {
	v, err := Normalize(value)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.value = v
	if s.File == "" {
		return nil
	}
	tmp := s.File + ".tmp"
	if err := os.WriteFile(tmp, []byte(v+"\n"), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.File)
}

// FileIn returns the position file inside dir.
func FileIn(dir string) string {
	return filepath.Join(dir, "posicion")
}
