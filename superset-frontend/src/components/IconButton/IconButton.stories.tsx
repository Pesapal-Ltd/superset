/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
<<<<<<<< HEAD:superset-frontend/src/components/IconButton/IconButton.stories.tsx
import { Meta, StoryObj } from '@storybook/react';
import { IconButton } from 'src/components/IconButton';

const meta: Meta<typeof IconButton> = {
  title: 'Components/IconButton',
  component: IconButton,
  argTypes: {
    onClick: { action: 'clicked' },
  },
  parameters: {
    a11y: {
      enabled: true,
    },
  },
};

export default meta;

type Story = StoryObj<typeof IconButton>;

export const Default: Story = {
  args: {
    buttonText: 'Default IconButton',
    altText: 'Default icon button alt text',
  },
};

export const CustomIcon: Story = {
  args: {
    buttonText: 'Custom icon IconButton',
    altText: 'Custom icon button alt text',
    icon: '/images/sqlite.png',
========
import TextControl from 'src/explore/components/controls/TextControl';
import CheckboxControl from 'src/explore/components/controls/CheckboxControl';
import FormRow from '.';

export default {
  title: 'FormRow',
};

export const InteractiveFormRow = ({ isCheckbox, ...rest }: any) => {
  const control = isCheckbox ? (
    <CheckboxControl label="Checkbox" />
  ) : (
    <TextControl />
  );
  return (
    <div style={{ width: 300 }}>
      <FormRow {...rest} control={control} isCheckbox={isCheckbox} />
    </div>
  );
};

InteractiveFormRow.args = {
  label: 'Label',
  tooltip: 'Tooltip',
  control: <TextControl />,
  isCheckbox: false,
};

InteractiveFormRow.argTypes = {
  control: {
    defaultValue: <TextControl />,
    table: {
      disable: true,
    },
>>>>>>>> 470785be0 (brought in the changes):superset-frontend/src/components/FormRow/FormRow.stories.tsx
  },
};
