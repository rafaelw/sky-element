/*
<!--
// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
-->
<import src="TemplateBinding.sky" />
<script>
*/

var Base = {
  __proto__: HTMLElement.prototype,

  register: function() {
    // |this| is prototype
    var template = document.currentScript.previousElementSibling;
    if (template && template.localName == 'template')
      this.template_ = template;
  },

  createdCallback: function() {
  },

  attachedCallback: function() {
    var shadow = this.createShadowRoot();
    shadow.appendChild(this.template_.createInstance(this));
    this.attached();
  },

  attached: function() {
    // override
  },

  dettachedCallback: function() {
    this.dettached();
  },

  dettached: function() {
    // override
  },

  attributeChangedCallback: function(attrName, oldValue, newValue) {
    // reserved for canonical behavior
    this.attributeChanged(attrName, oldValue, newValue);
  },

  attributeChanged: function(attrName, oldValue, newValue) {
    // override
  }
};

function SkyElement(prototype) {
  prototype.__proto__ = Base;
  document.registerElement(prototype.name, { prototype: prototype });
  prototype.register();
};

/*
module.exports = SkyElement;
</script>

*/
